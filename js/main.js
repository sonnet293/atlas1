// js/main.js — 배틀룸 목록 (rooms 컬렉션을 구독해서 방마다 상태를 실시간 표시)
import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut }
from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc, collection, onSnapshot }
from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { ROOMS, roomStatus, PLAYER_SLOTS } from "./rooms.js";
import { fillAvatar } from "./avatar.js";

const grid = document.getElementById("room-grid");
const summary = document.getElementById("room-summary");
const cards = new Map(); // roomId -> 카드 요소
let myUid = null;
let unsubRooms = null;

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
};

const page = el("div", "room-page");
page.setAttribute("aria-label", "방 목록");
grid.append(page);

// 카드 뼈대는 로그인 확인 전에 먼저 그려둔다
for (const info of ROOMS) {
    const card = el("a", "room-card");
    card.href = `pages/battleroom${info.no}.html`;
    card.dataset.roomId = info.id;

    const visual = el("div", "room-visual");
    const pill = el("span", "status-pill");
    pill.append(el("span", "status-label", "불러오는 중"));
    visual.append(pill);
    const mine = el("span", "room-mine", "(내 방)");
    mine.hidden = true;
    visual.append(mine);

    const body = el("div", "room-body");
    body.append(el("h2", "room-name", info.name));
    const seats = el("div", "room-seats");
    seats.append(makeSeat("P1"), el("span", "room-vs", "VS"), makeSeat("P2"));
    body.append(seats);
    const foot = el("div", "room-foot");
    foot.append(el("span", "room-watchers", "관전 0"), el("span", "room-cta", "입장"));
    body.append(foot);

    card.append(visual, body);
    page.append(card);
    cards.set(info.id, card);
}

function makeSeat(label) {
    const seat = el("div", "seat");
    seat.append(el("span", "seat-label", label), el("span", "seat-name", "-"), el("span", "seat-ready"));
    return seat;
}

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        location.href = "index.html";
        return;
    }
    myUid = user.uid;

    const userSnap = await getDoc(doc(db, "users", myUid));
    const nickname = userSnap.data()?.nickname ?? "Trainer";
    document.getElementById("trainer-name").textContent = nickname;
    fillAvatar(document.getElementById("trainer-initial"), {
        uid: myUid,
        name: nickname,
        src: userSnap.data()?.profileImage,
    });

    if (!unsubRooms) {
        unsubRooms = onSnapshot(collection(db, "rooms"), (snap) => {
            const rooms = new Map(snap.docs.map((d) => [d.id, d.data()]));
            renderRooms(rooms);
        });
    }
});

document.getElementById("logoutBtn").onclick = () => signOut(auth);

function renderRooms(rooms) {
    const counts = { waiting: 0, playing: 0, ended: 0 };

    for (const info of ROOMS) {
        const room = rooms.get(info.id);
        const status = roomStatus(room);
        if (status.key in counts) counts[status.key]++;
        renderCard(cards.get(info.id), room, status);
    }

    summary.innerHTML = "";
    const labels = { waiting: "대기 중", playing: "배틀 중", ended: "종료" };
    for (const [key, n] of Object.entries(counts)) {
        if (!n) continue;
        const pill = el("span", "status-pill");
        pill.dataset.status = key;
        pill.append(`${labels[key]} ${n}`);
        summary.append(pill);
    }
}

function renderCard(card, room, status) {
    card.dataset.status = status.key;
    card.querySelector(".status-label").textContent = status.label;

    const closed = status.key === "closed";
    card.setAttribute("aria-disabled", String(closed));
    card.tabIndex = closed ? -1 : 0;

    const seats = card.querySelectorAll(".seat");
    const slots = PLAYER_SLOTS;
    slots.forEach((slot, i) => {
        const seat = seats[i];
        const name = room?.[`${slot}_name`];
        const key = `p${i + 1}`;
        const won = room?.battle_winner === key;
        seat.dataset.empty = String(!name);
        seat.dataset.winner = String(!!name && won);
        seat.querySelector(".seat-name").textContent = name ?? "-";

        let tag = "";
        if (status.key === "ended" && won) tag = "WIN";
        else if (status.key === "waiting" && room?.[`${slot}_ready`]) tag = "READY";
        seat.querySelector(".seat-ready").textContent = tag;
    });

    const spectatorCount = room?.spectators?.length ?? 0;
    card.querySelector(".room-watchers").textContent = closed ? "GM이 방을 열면 입장할 수 있어요" : `관전 ${spectatorCount}`;

    const isMine = !!room && !!myUid && (
        slots.some((slot) => room[`${slot}_uid`] === myUid) ||
        (room.spectators ?? []).includes(myUid)
    );
    card.querySelector(".room-mine").hidden = !isMine;

    const seatsFull = slots.every((slot) => !!room?.[`${slot}_uid`]);
    let cta = "입장";
    if (closed) cta = "";
    else if (isMine) cta = "입장";
    else if (status.key !== "waiting" || seatsFull) cta = "관전";
    card.querySelector(".room-cta").textContent = cta;
}
