// js/doubleChat.js
// 더블배틀 채팅. 채널은 rooms/{ROOM_ID}/chats/{channel}/messages 로 나뉜다.
//   - t1: A팀(player1·2) 채팅  — A팀과 관전자만 읽을 수 있음, A팀만 쓸 수 있음
//   - t2: B팀(player3·4) 채팅  — B팀과 관전자만 읽을 수 있음, B팀만 쓸 수 있음
//   - spectator: 관전자 채팅   — 관전자만 읽고 쓸 수 있음
// 실제 접근 제한은 firestore.rules가 강제하고, 이 파일은 내 자리에 맞는 채널만 구독한다.
// 지난 게임의 메시지는 gameId(game_started_at)로 걸러서 읽지 않는다.
import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc,
  collection,
  query,
  where,
  orderBy,
  limitToLast,
  addDoc,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const roomRef = doc(db, "rooms", ROOM_ID);
const MAX_LEN = 200;
const MAX_SHOWN = 100;

const CHANNEL_LABEL = { t1: "A팀", t2: "B팀", spectator: "관전" };
const TEAM_SLOTS = { t1: ["player1", "player2"], t2: ["player3", "player4"] };

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

let myUid = null;
let role = null; // "t1" | "t2" | "spectator" | null
let myName = "";
let gameId = null;
const subs = new Map(); // channel -> unsubscribe
const messages = new Map(); // channel -> [{ id, ...data }]

const root = document.getElementById("dbl-chat");

// ---- 화면 ----
const ui = (() => {
  if (!root) return null;
  const head = el("div", "chat-head");
  const title = el("span", "chat-title", "채팅");
  const hint = el("span", "chat-hint");
  head.append(title, hint);
  const list = el("div", "chat-list");
  list.setAttribute("role", "log");
  list.setAttribute("aria-live", "polite");
  const form = el("form", "chat-form");
  const input = el("input", "chat-input");
  input.type = "text";
  input.maxLength = MAX_LEN;
  input.placeholder = "메시지 입력";
  input.autocomplete = "off";
  const send = el("button", "chat-send", "전송");
  send.type = "submit";
  form.append(input, send);
  root.append(head, list, form);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage(input);
  });
  return { title, hint, list, input, send };
})();

// "(이렇게 괄호 친 글씨)"는 회색 + 기울임으로. 전각 괄호（）도 같이 처리. innerHTML 없이 텍스트 노드로만 만든다.
function renderText(text) {
  const frag = document.createDocumentFragment();
  const re = /(\([^()]*\)|（[^（）]*）)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    frag.append(el("span", "chat-paren", m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

const msgTime = (m) => m.createdAt?.toMillis?.() ?? Date.now(); // 아직 서버 시각이 없는(방금 보낸) 메시지는 맨 뒤

function render() {
  if (!ui) return;
  const all = [...messages.entries()]
    .flatMap(([channel, list]) => list.map((m) => ({ ...m, channel })))
    .filter((m) => m.gameId === gameId)
    .sort((a, b) => msgTime(a) - msgTime(b))
    .slice(-MAX_SHOWN);

  const atBottom = ui.list.scrollHeight - ui.list.scrollTop - ui.list.clientHeight < 30;
  ui.list.replaceChildren();
  if (all.length === 0) ui.list.append(el("div", "chat-empty", "아직 메시지가 없습니다."));
  const showLabel = role === "spectator"; // 관전자는 세 채널을 한 화면에서 보므로 채널 표시
  for (const m of all) {
    const line = el("div", "chat-line");
    line.dataset.channel = m.channel;
    line.dataset.me = String(m.uid === myUid);
    if (showLabel) line.append(el("span", "chat-tag", `[${CHANNEL_LABEL[m.channel]}]`));
    line.append(el("span", "chat-name", `${m.name ?? "?"}:`), " ");
    const body = el("span", "chat-text");
    body.append(renderText(String(m.text ?? "")));
    line.append(body);
    ui.list.append(line);
  }
  if (atBottom) ui.list.scrollTop = ui.list.scrollHeight;
}

// ---- 내 자리에 따른 채널 ----
function calcRole(room) {
  for (const [team, slots] of Object.entries(TEAM_SLOTS)) {
    const slot = slots.find((s) => room[`${s}_uid`] === myUid);
    if (slot) return { role: team, name: room[`${slot}_name`] ?? "" };
  }
  const idx = (room.spectators ?? []).indexOf(myUid);
  if (idx >= 0) return { role: "spectator", name: room.spectator_names?.[idx] ?? "" };
  return { role: null, name: "" };
}

// 플레이어: 자기 팀 채널만 / 관전자: 세 채널 모두 읽고 관전자 채널에 씀
const readableChannels = (r) => (r === "spectator" ? ["t1", "t2", "spectator"] : r ? [r] : []);

// 구독 쿼리가 걸러 읽는 게임. 게임이 바뀌면 모든 채널을 새 gameId로 다시 구독한다.
let subsGameId;

function resubscribe() {
  const want = new Set(readableChannels(role));
  const gameChanged = subsGameId !== gameId;
  for (const [ch, unsub] of subs) {
    if (gameChanged || !want.has(ch)) { unsub(); subs.delete(ch); messages.delete(ch); }
  }
  subsGameId = gameId;
  for (const ch of want) {
    if (subs.has(ch)) continue;
    // 지난 게임 메시지는 서버에서 걸러서 읽기 횟수를 아낀다 (색인: gameId 오름차순 + createdAt 내림차순)
    const q = query(
      collection(roomRef, "chats", ch, "messages"),
      where("gameId", "==", gameId),
      orderBy("createdAt"),
      limitToLast(MAX_SHOWN)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        messages.set(ch, snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) })));
        render();
      },
      (err) => {
        // 자리가 바뀌는 순간 등 권한이 없어지면 그 채널 구독만 정리
        console.warn(`채팅 구독 실패(${ch}):`, err.code ?? err);
        subs.delete(ch);
        messages.delete(ch);
        render();
      }
    );
    subs.set(ch, unsub);
  }
  render();
}

function renderHeader() {
  if (!ui) return;
  root.hidden = !role;
  root.dataset.role = role ?? "";
  if (role === "spectator") {
    ui.title.textContent = "관전자 채팅";
  } else if (role) {
    ui.title.textContent = `${CHANNEL_LABEL[role]} 채팅`;
  }
}

let sending = false;
async function sendMessage(input) {
  const text = input.value.trim().slice(0, MAX_LEN);
  if (!text || !role || !myUid || sending) return;
  sending = true;
  ui.send.disabled = true;
  try {
    await addDoc(collection(roomRef, "chats", role, "messages"), {
      uid: myUid,
      name: (myName || "트레이너").slice(0, 20),
      text,
      gameId,
      createdAt: serverTimestamp(),
    });
    input.value = "";
  } catch (err) {
    console.error("채팅 전송 실패:", err);
  } finally {
    sending = false;
    ui.send.disabled = false;
    input.focus();
  }
}

onAuthStateChanged(auth, (user) => {
  if (!user || !root) return;
  myUid = user.uid;
  onSnapshot(roomRef, (snap) => {
    const room = snap.data();
    if (!room) return;
    const me = calcRole(room);
    const gid = room.game_started_at ?? null;
    const changed = me.role !== role || gid !== gameId;
    role = me.role;
    myName = me.name;
    gameId = gid;
    if (changed) {
      renderHeader();
      resubscribe();
    }
  });
});
