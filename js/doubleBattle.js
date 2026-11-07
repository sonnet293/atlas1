// js/doubleBattle.js
// 더블배틀(2:2) 플레이어/관전자 화면. 판정은 하지 않고 rooms/{ROOM_ID}/actions에 요청만 생성한다.
// 실제 판정과 방 상태 갱신은 GM 브라우저(gm/gm.js)가 js/doubleEngine.js로 처리한다.
// 화면 구성: 왼쪽 = 우리 팀(나 + 아군), 오른쪽 = 상대 팀, 상단 = 이번 라운드 행동 순서.
import { auth, db } from "./firebase.js";
import { onAuthStateChanged }
from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc,
  collection,
  addDoc,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { MOVES } from "./moves.js";
import { formatPokemonName } from "./effecthandler.js";
import {
  DOUBLE_SIDES,
  TEAMS,
  teamOf,
  otherTeam,
  allyOf,
  enemiesOf,
  slotOf,
  displayName,
  teamName,
  needsTarget,
  isMoveLocked,
  isRecharging,
  turnWaitKey,
  TURN_TIME_LIMIT_MS,
} from "./doubleEngine.js";
import { vacateSeat } from "./roomLeave.js";
import { portraitUrl } from "./portrait.js";

const roomRef = doc(db, "rooms", ROOM_ID);
const actionsRef = collection(roomRef, "actions");
const isSpectatorView = new URLSearchParams(location.search).get("spectator") === "true";

const MOVE_BUTTON_COUNT = 4;
const GM_WAIT_NOTICE_MS = 5000;

const TYPE_COLORS = {
  노말: "#949495", 불: "#e56c3e", 물: "#5185c5", 전기: "#fbb917", 풀: "#66a945",
  얼음: "#6dc8eb", 격투: "#e09c40", 독: "#735198", 땅: "#9c7743", 바위: "#bfb889",
  비행: "#a2c3e7", 에스퍼: "#dd6b7b", 벌레: "#9fa244", 고스트: "#684870",
  드래곤: "#535ca8", 악: "#4c4948", 강철: "#69a9c7", 페어리: "#dab4d4",
};

// 인트로(네 명 터치 + VS 연출)가 끝나기 전까지 첫 라운드(주사위)를 시작하지 않는다
const hasIntro = !!document.getElementById("intro-overlay");
let introReady = !hasIntro;
let latestRoomForInit = null;

if (hasIntro) {
  document.addEventListener("battle:introDone", () => {
    introReady = true;
    if (latestRoomForInit) maybeInitRound(latestRoomForInit);
  }, { once: true });
}

let myUid = null;
let myKey = null; // "p1"~"p4" | null(관전자)
let latestRoom = null;
let roundInitInFlight = false;
let lastQueuedRound = 0; // 주사위 연출을 큐에 넣은 마지막 라운드
let diceQueued = 0; // 큐에 들어가 아직 끝나지 않은 주사위 연출 수
let isAnimating = false; // 주사위 연출이 남아 있는 동안 true (기술/교체 버튼 잠금)
let diceRolling = false;
let actionInFlight = false;

// 라운드 시작 때 나와 있던 포켓몬 이름 (행동 순서 표시에서 쓰러져 행동을 잃은 포켓몬 이름용)
let roundStartNames = {};

// 기술을 누른 뒤 대상/유턴 교체 대상을 고르는 중이면 { moveIdx, target, needTarget, needPivot }
let pick = null;

const DICE_SOUND_URL = "https://slippery-copper-mzpmcmc2ra.edgeone.app/soundreality-bicycle-bell-155622.mp3";
const diceSound = new Audio(DICE_SOUND_URL);

const BUTTON_SOUND_URL = "https://usual-salmon-mnqxptwyvw.edgeone.app/Pokemon%20(A%20Button)%20-%20Sound%20Effect%20(HD)%20(1)%20(1).mp3";
const buttonSound = new Audio(BUTTON_SOUND_URL);

function playButtonSound() {
  buttonSound.currentTime = 0;
  buttonSound.play().catch(() => {});
}

const $ = (id) => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

function calcMyKey(room) {
  if (!room || !myUid || isSpectatorView) return null;
  return DOUBLE_SIDES.find((k) => room[`${slotOf(k)}_uid`] === myUid) ?? null;
}

// 화면 배치: 왼쪽 = 우리 팀(내가 위), 오른쪽 = 상대 팀. 관전자는 팀 A가 왼쪽.
function perspective() {
  if (myKey) return { mine: [myKey, allyOf(myKey)], enemy: enemiesOf(myKey), mineTeam: teamOf(myKey) };
  return { mine: TEAMS.t1, enemy: TEAMS.t2, mineTeam: "t1" };
}
const isEnemySide = (k) => perspective().enemy.includes(k);

const activeOf = (room, k) => room[`${k}_entry`]?.[room[`${k}_active_idx`] ?? 0] ?? null;
const inBattle = (room, k) => !room[`${k}_out`] && (activeOf(room, k)?.hp ?? 0) > 0;
const anyPending = (room) => DOUBLE_SIDES.some((k) => room[`${k}_pending_switch`]);
const entriesReady = (room) => DOUBLE_SIDES.every((k) => room[`${k}_entry`]?.length);

// GM에게 요청(action)을 보내고, GM이 처리(done/rejected)할 때까지 기다린다.
function sendAction(type, payload = {}) {
  return new Promise(async (resolve) => {
    let noticeTimer = null;
    try {
      const ref = await addDoc(actionsRef, {
        uid: myUid,
        type,
        payload,
        round_no: latestRoom?.round_no ?? 0,
        status: "pending",
        createdAt: serverTimestamp(),
      });
      noticeTimer = setTimeout(() => {
        const node = $("turn-indicator");
        if (node) node.innerText = "GM 응답 대기 중...";
      }, GM_WAIT_NOTICE_MS);
      const unsub = onSnapshot(ref, (snap) => {
        const action = snap.data();
        if (!action || action.status === "pending") return;
        clearTimeout(noticeTimer);
        unsub();
        if (action.status === "rejected") console.warn(`요청 거절됨(${type}):`, action.reason);
        resolve(action);
      });
    } catch (err) {
      clearTimeout(noticeTimer);
      console.error(`요청 전송 실패(${type}):`, err);
      resolve({ status: "error", reason: String(err) });
    }
  });
}

async function requestTurnAction(type, payload) {
  if (!myKey || isAnimating || actionInFlight) return;
  actionInFlight = true;
  pick = null;
  if (latestRoom) renderTurnUI(latestRoom);
  try {
    await sendAction(type, payload);
  } finally {
    actionInFlight = false;
    if (latestRoom && !isAnimating) renderTurnUI(latestRoom);
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  myUid = user.uid;
  listenBattle();
});

function listenBattle() {
  onSnapshot(roomRef, (snap) => {
    const room = snap.data();
    if (!room) return;
    latestRoom = room;

    const key = calcMyKey(room);
    if (key !== myKey || !panelsBuilt) {
      myKey = key;
      buildPanels(room);
    }

    // 새 라운드(주사위)는 라운드마다 한 번만 연출 큐에 넣는다.
    // 이전 줄 연출 -> 주사위 -> "~의 선공!" -> 그 뒤에 도착한 행동들 순서로 재생된다.
    const roundNo = room.round_no ?? 0;
    if (roundNo < lastQueuedRound) lastQueuedRound = 0; // 새 게임으로 초기화됨
    const isNewRound = !!room.battle_turn && roundNo > lastQueuedRound;

    renderBoard(room, isNewRound);
    latestRoomForInit = room;
    maybeInitRound(room);
    if (!isAnimating || isNewRound) renderTurnUI(room);
  });
}

function diceStep(room) {
  const { mine, enemy } = perspective();
  const rolls = [...mine, ...enemy]
    .filter((k) => room[`${k}_roll`] != null)
    .map((k) => ({ k, roll: room[`${k}_roll`] }));
  const names = Object.fromEntries(DOUBLE_SIDES.map((k) => [k, activeOf(room, k)?.name ?? null]));
  lastQueuedRound = room.round_no ?? 0;
  diceQueued++;
  isAnimating = true;
  return { kind: "dice", rolls, names };
}

// 게임이 막 시작됐는데 아직 첫 라운드가 없으면 player1이 GM에게 첫 라운드 세팅을 요청
async function maybeInitRound(room) {
  if (!introReady) return;
  if (!room.game_started || (room.round_no ?? 0) > 0 || room.battle_winner) return;
  if (myKey !== "p1" || roundInitInFlight) return;
  if (!entriesReady(room)) return;

  roundInitInFlight = true;
  await sendAction("init");
}

function useMove(moveIdx, target = null, switchIdx = null) {
  const payload = { moveIdx };
  if (target) payload.target = target;
  if (switchIdx !== null) payload.switchIdx = switchIdx;
  return requestTurnAction("move", payload);
}

function switchPokemon(targetIdx) {
  return requestTurnAction("switch", { targetIdx });
}

// 전투 종료 후 LEAVE
let leaveInFlight = false;
let sawBattle = false;
async function leaveBattle() {
  if (leaveInFlight || !latestRoom) return;
  const alreadyReset = sawBattle && !latestRoom.game_started;
  if (!latestRoom.battle_winner && !alreadyReset) return;

  leaveInFlight = true;
  if (alreadyReset) {
    await vacateSeat(roomRef, latestRoom, myUid);
  } else {
    const result = await sendAction("leave");
    if (result.status !== "done") {
      leaveInFlight = false;
      return;
    }
  }
  location.href = "../main.html";
}

function renderLeaveButton(room) {
  const btn = $("leaveBtn");
  if (!btn) return;
  if (room.game_started) sawBattle = true;
  const canLeave = !!room.battle_winner || (sawBattle && !room.game_started);
  btn.style.display = canLeave ? "inline-block" : "none";
  btn.onclick = () => {
    playButtonSound();
    leaveBattle();
  };
}

// ---- 포켓몬 패널 (플레이어 한 명당 하나) ----
let panelsBuilt = false;

function buildPanels(room) {
  const { mine, enemy } = perspective();
  const build = (containerId, sides, isEnemy) => {
    const box = $(containerId);
    box.replaceChildren();
    for (const k of sides) {
      const slot = el("div", "dbl-slot");
      slot.id = `slot-${k}`;
      slot.dataset.side = k;
      slot.dataset.enemy = String(isEnemy);
      slot.dataset.me = String(k === myKey);

      const head = el("div", "slot-head");
      head.append(el("span", "slot-owner", displayName(k, room)));
      head.querySelector(".slot-owner").id = `owner-${k}`;
      const tag = el("span", "slot-tag", k === myKey ? "YOU" : "");
      head.append(tag);

      const panel = el("div", `pokemon-panel ${isEnemy ? "oppnent" : "mine"}`);
      panel.id = `panel-${k}`;

      const portraitWrap = el("div", "portrait-wrap");
      const ph = el("div", "portrait-placeholder");
      ph.id = `portrait-ph-${k}`;
      const img = el("img", "portrait-img");
      img.id = `portrait-${k}`;
      img.alt = "";
      portraitWrap.append(ph, img);

      const card = el("div", "hp-card");
      const info = el("div", "hp-info");
      const stats = el("div", "stats");
      stats.id = `stats-${k}`;
      const hp = el("span", "hp-text", "-");
      hp.id = `hp-${k}`;
      if (isEnemy) hp.style.display = "none"; // 상대 HP 숫자는 숨김
      info.append(stats, hp);
      const barBg = el("div", "hp-bar-bg");
      const bar = el("div", "hp-bar");
      bar.id = `hpbar-${k}`;
      barBg.append(bar);
      card.append(info, barBg);

      if (isEnemy) panel.append(card, portraitWrap);
      else panel.append(portraitWrap, card);

      slot.append(head, panel);
      slot.addEventListener("click", () => onPanelClick(k));
      box.append(slot);
    }
  };
  build("mine-panels", mine, false);
  build("enemy-panels", enemy, true);
  panelsBuilt = true;
  boardInitialized = false; // 배치가 바뀌었으면 현재 상태를 즉시 다시 그림
  renderedLogCount = 0;
  renderedEventCount = 0;
}

function renderBoard(room, isNewRound = false) {
  const { mine, enemy, mineTeam } = perspective();
  $("mine-team-name").innerText = myKey ? `${teamName(mineTeam, room)}` : teamName("t1", room);
  $("enemy-team-name").innerText = teamName(otherTeam(mineTeam), room);
  for (const k of [...mine, ...enemy]) {
    const owner = $(`owner-${k}`);
    if (owner) owner.innerText = displayName(k, room);
    const slot = $(`slot-${k}`);
    if (slot) slot.dataset.out = String(!!room[`${k}_out`]);
  }

  renderLogAndBoard(room, isNewRound);
  renderResult(room);
  renderLeaveButton(room);
}

function renderTurnUI(room) {
  if (room.battle_turn !== myKey || room.battle_winner) pick = null;
  renderTurn(room);
  renderTurnOrder(room);
  renderTargetPicker(room);
  renderMoveButtons(room);
  renderBench(room);
  syncTurnTimer(room);
}

// ---- 턴 제한시간 ----
// 누군가의 차례가 시작된 순간(주사위 연출 뒤)부터 이 브라우저에서 잰다. { key, deadline }
// 카운트다운은 모두(다른 플레이어·관전자 포함)에게 보이고, 시간 초과 자동 행동은 차례인 본인 화면만 요청한다.
let turnTimer = null;
let turnTimerInterval = null;

function turnTimerNode() {
  let node = $("turn-timer");
  if (!node) {
    node = el("div", "turn-timer");
    node.id = "turn-timer";
    $("turn-indicator")?.after(node);
  }
  return node;
}

function syncTurnTimer(room) {
  const key = turnWaitKey(room);
  if (!key) {
    stopTurnTimer();
    return;
  }
  if (turnTimer?.key === key || isAnimating) return;
  turnTimer = { key, deadline: Date.now() + TURN_TIME_LIMIT_MS };
  clearInterval(turnTimerInterval);
  turnTimerInterval = setInterval(tickTurnTimer, 250);
  tickTurnTimer();
}

function stopTurnTimer() {
  turnTimer = null;
  clearInterval(turnTimerInterval);
  turnTimerInterval = null;
  const node = $("turn-timer");
  if (node) node.hidden = true;
}

function tickTurnTimer() {
  const room = latestRoom;
  if (!turnTimer || !room || turnWaitKey(room) !== turnTimer.key) {
    stopTurnTimer();
    return;
  }
  const left = Math.max(0, turnTimer.deadline - Date.now());
  const node = turnTimerNode();
  node.hidden = false;
  node.textContent = `남은 시간 ${Math.ceil(left / 1000)}초`;
  node.dataset.urgent = String(left <= 10000);
  if (left > 0) return;
  if (room.battle_turn !== myKey) { node.textContent = "시간 초과!"; return; } // 다른 사람 차례는 표시만 (자동 행동은 본인 화면/GM이)
  if (!canActNow(room)) return; // 요청 처리 중이면 결과를 기다림
  stopTurnTimer();
  autoAct();
}

// 시간 초과: GM이 자동 행동을 정함 (고르던 기술/대상이 있으면 그걸 우선, 나머지는 무작위)
function autoAct() {
  const prefer = pick ? { moveIdx: pick.moveIdx, target: pick.target ?? null } : null;
  return requestTurnAction("timeout", prefer ? { prefer } : {});
}

function updateHpBar(k, hp, maxHp) {
  const bar = $(`hpbar-${k}`), txt = $(`hp-${k}`);
  if (!bar) return;
  const pct = maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0;
  bar.style.width = pct + "%";
  bar.style.backgroundColor = pct > 50 ? "#4caf50" : pct > 20 ? "#ff9800" : "#f44336";
  if (txt) txt.innerText = `HP: ${hp} / ${maxHp}`;
}

function updatePortrait(k, pokemon, animate = false) {
  const img = $(`portrait-${k}`);
  const placeholder = $(`portrait-ph-${k}`);
  if (!img) return;
  if (!pokemon?.portrait) {
    img.classList.remove("visible"); img.style.display = "none";
    if (placeholder) placeholder.style.display = "block"; return;
  }
  if (placeholder) placeholder.style.display = "none";
  img.classList.remove("visible", "slide-in-mine", "slide-in-enemy");
  img.style.display = "block"; img.src = portraitUrl(pokemon.portrait); img.alt = pokemon.name;
  setTimeout(() => {
    img.classList.add("visible", ...(animate ? [isEnemySide(k) ? "slide-in-enemy" : "slide-in-mine"] : []));
  }, 80);
}

function triggerAttackEffect(atkKey, defKey) {
  return new Promise(resolve => {
    const atkArea = atkKey ? $(`panel-${atkKey}`) : null;
    const defArea = $(`panel-${defKey}`);
    const wrapper = $("battle-wrapper");
    if (atkArea) { atkArea.classList.add("attacker-flash"); atkArea.addEventListener("animationend", () => atkArea.classList.remove("attacker-flash"), { once: true }); }
    if (wrapper) { wrapper.classList.add("screen-shake"); wrapper.addEventListener("animationend", () => wrapper.classList.remove("screen-shake"), { once: true }); }
    setTimeout(() => {
      if (defArea) { defArea.classList.add("defender-hit"); defArea.addEventListener("animationend", () => { defArea.classList.remove("defender-hit"); resolve(); }, { once: true }); }
      else resolve();
    }, 120);
  });
}

function triggerBlink(k) {
  return new Promise(resolve => {
    const area = $(`panel-${k}`);
    if (!area) { resolve(); return; }
    area.classList.add("blink-damage");
    area.addEventListener("animationend", () => { area.classList.remove("blink-damage"); resolve(); }, { once: true });
  });
}

// 화면에 지금 표시 중인 포켓몬 (연출 도중의 상태)
const shownPokemon = {};

function applyPokemonVisual(k, pkmn) {
  shownPokemon[k] = pkmn;
  const hpText = $(`hp-${k}`);
  const stats = $(`stats-${k}`);
  if (!hpText || !stats) return;

  if (!pkmn) {
    hpText.innerText = "-";
    $(`hpbar-${k}`).style.width = "0%";
    stats.innerText = "";
    updatePortrait(k, null);
    return;
  }
  updateHpBar(k, pkmn.hp, pkmn.maxHp);
  stats.innerText = formatPokemonName(pkmn);
  $(`portrait-${k}`)?.classList.toggle("fainted", pkmn.hp <= 0);
  $(`slot-${k}`)?.setAttribute("data-fainted", String(pkmn.hp <= 0));
}

// ---- 기술 / 대상 / 교체 ----
function myActive(room) {
  return myKey ? activeOf(room, myKey) : null;
}

function canActNow(room) {
  return !!myKey && room.battle_turn === myKey && !room.battle_winner && !isAnimating && !actionInFlight;
}

function liveEnemies(room) {
  return myKey ? enemiesOf(myKey).filter((k) => inBattle(room, k)) : [];
}

// 고를 수 있는 대상 (씨뿌리기는 아군도 가능)
function targetChoices(room, moveData) {
  const ally = myKey && moveData?.leechSeed && inBattle(room, allyOf(myKey)) ? [allyOf(myKey)] : [];
  return [...liveEnemies(room), ...ally];
}

const pickMoveData = (room) => MOVES[myActive(room)?.moves?.[pick?.moveIdx]?.name];

function benchAlive(room) {
  const idx = room[`${myKey}_active_idx`] ?? 0;
  return (room[`${myKey}_entry`] ?? []).some((p, i) => i !== idx && p && p.hp > 0);
}

function onMoveClick(room, i) {
  const me = myActive(room);
  const move = me?.moves?.[i];
  const moveData = MOVES[move?.name];
  if (!move) return;

  // 고스트다이브로 사라진 상태: 서버가 그 기술로 강제 공격
  if (me.ghostDive) { useMove(i); return; }

  if (pick?.moveIdx === i) { pick = null; renderTurnUI(room); return; } // 같은 버튼 다시 누르면 취소

  const enemies = liveEnemies(room);
  const counterAuto = moveData?.counter && me.lastHitBy && enemies.includes(me.lastHitBy);
  const needT = needsTarget(moveData) && targetChoices(room, moveData).length > 1 && !counterAuto && !isRecharging(me, room.round_no ?? 0);
  const needP = !!moveData?.uTurn && me.hp > 0 && benchAlive(room) && !isRecharging(me, room.round_no ?? 0);

  if (!needT && !needP) {
    useMove(i, needsTarget(moveData) ? (enemies[0] ?? null) : null);
    return;
  }
  pick = { moveIdx: i, target: needT ? null : (enemies[0] ?? null), needTarget: needT, needPivot: needP };
  renderTurnUI(room);
}

function chooseTarget(room, k) {
  if (!pick || !pick.needTarget || pick.target) return;
  if (!targetChoices(room, pickMoveData(room)).includes(k)) return;
  playButtonSound();
  pick.target = k;
  if (pick.needPivot) { renderTurnUI(room); return; }
  useMove(pick.moveIdx, k);
}

function onPanelClick(k) {
  if (!latestRoom || !canActNow(latestRoom)) return;
  chooseTarget(latestRoom, k);
}

function renderTargetPicker(room) {
  const box = $("target-picker");
  const choosing = !!pick?.needTarget && !pick.target && canActNow(room);
  box.hidden = !choosing;
  box.replaceChildren();
  const choices = choosing ? targetChoices(room, pickMoveData(room)) : [];
  for (const k of DOUBLE_SIDES) $(`slot-${k}`)?.classList.toggle("targetable", choices.includes(k));
  if (!choosing) return;

  const moveName = myActive(room)?.moves?.[pick.moveIdx]?.name ?? "";
  box.append(el("span", "target-label", `${moveName} → 대상 선택`));
  for (const k of choices) {
    const btn = el("button", "target-btn");
    btn.type = "button";
    btn.append(el("span", "target-name", activeOf(room, k)?.name ?? "포켓몬"), el("span", "target-owner", displayName(k, room)));
    btn.onclick = () => chooseTarget(room, k);
    box.append(btn);
  }
  const cancel = el("button", "target-cancel", "취소");
  cancel.type = "button";
  cancel.onclick = () => { playButtonSound(); pick = null; renderTurnUI(room); };
  box.append(cancel);
}

function renderMoveButtons(room) {
  const me = myActive(room);
  for (let i = 0; i < MOVE_BUTTON_COUNT; i++) {
    const btn = $(`moveBtn${i}`);
    if (!btn) continue;
    const move = me?.moves?.[i];
    if (!myKey || !move || room[`${myKey}_out`]) {
      btn.style.display = "none";
      continue;
    }

    const canAct = canActNow(room);
    const diving = me.ghostDive;
    const locked = isMoveLocked(me, move.name, room.round_no ?? 0);
    // 파괴광선 반동 라운드엔 아무 버튼이나 눌러 턴을 넘김 (서버가 행동 불가 처리)
    const recharging = isRecharging(me, room.round_no ?? 0);
    const usable = diving ? canAct && diving.moveIdx === i : canAct && (recharging || ((move.pp ?? 0) > 0 && !locked)) && me.hp > 0;

    const moveData = MOVES[move.name];
    btn.classList.toggle("uturn-picking", pick?.moveIdx === i);
    btn.style.display = "inline-flex";
    btn.style.backgroundColor = TYPE_COLORS[moveData?.type] ?? "var(--accent)";
    btn.style.opacity = usable ? "1" : "0.45";
    const weatherType = room.weather?.type;
    const accuracy = moveData?.weatherAccuracy?.[weatherType] ?? moveData?.accuracy;
    const alwaysHit = moveData?.alwaysHit || moveData?.weatherAlwaysHit?.includes(weatherType);
    const accText = alwaysHit ? "필중" : `${accuracy ?? "-"}%`;
    btn.innerHTML = "";
    btn.append(el("span", "move-btn-name", move.name), el("span", "move-btn-info", `PP ${move.pp} | ${accText}`));
    btn.disabled = !usable;
    btn.onclick = () => {
      playButtonSound();
      onMoveClick(room, i);
    };
  }
}

function renderBench(room) {
  const container = $("mine-bench");
  if (!container) return;
  container.innerHTML = "";
  if (!myKey) return;

  const entry = room[`${myKey}_entry`] ?? [];
  const activeIdx = room[`${myKey}_active_idx`] ?? 0;
  const pendingSwitch = !!room[`${myKey}_pending_switch`];
  const me = entry[activeIdx];

  const canForcedSwitch = pendingSwitch && !actionInFlight;
  const canPivotSwitch = !!pick?.needPivot && !!pick.target && canActNow(room);
  const canVoluntarySwitch =
    !pick &&
    !pendingSwitch &&
    !anyPending(room) &&
    !me?.ghostDive &&
    !me?.trap &&
    !isRecharging(me, room.round_no ?? 0) && // 파괴광선 반동 중엔 교체 불가
    canActNow(room);

  entry.forEach((pkmn, idx) => {
    if (!pkmn) return;
    if (idx === activeIdx && !pendingSwitch) return;

    const isFainted = pkmn.hp <= 0;
    const usable = (canForcedSwitch || canVoluntarySwitch || canPivotSwitch) && !isFainted && idx !== activeIdx;

    const btn = el("button", "bench-btn");
    btn.type = "button";
    btn.disabled = !usable;
    if (isFainted) btn.classList.add("fainted");
    btn.append(el("span", "bench-name", formatPokemonName(pkmn)), el("span", "bench-hp", `${pkmn.hp}/${pkmn.maxHp}`));
    btn.onclick = () => {
      playButtonSound();
      if (canPivotSwitch) useMove(pick.moveIdx, pick.target, idx);
      else switchPokemon(idx);
    };
    container.appendChild(btn);
  });
  container.style.display = "flex";
}

// ---- 상단 행동 순서 ----
function renderTurnOrder(room) {
  const bar = $("turn-order");
  if (!bar) return;
  bar.replaceChildren();
  const order = room.turn_order ?? [];
  if (!room.game_started || order.length === 0 || room.battle_winner) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  bar.append(el("span", "to-title", `ROUND ${room.round_no ?? "-"}`));

  if (diceRolling || isAnimating) {
    bar.append(el("span", "to-wait", "주사위 굴리는 중..."));
    return;
  }

  const skip = new Set(room.round_skip ?? []);
  const pos = room.turn_pos ?? 0;
  order.forEach((k, i) => {
    if (i > 0) bar.append(el("span", "to-arrow", "›"));
    const chip = el("span", "to-chip");
    // skip: 이번 라운드에 쓰러져 행동을 잃음 / done: 행동 끝 / now: 지금 차례 / next: 대기
    let state = "next";
    if (skip.has(k)) state = "skip";
    else if (i === pos && room.battle_turn === k) state = "now";
    else if (i <= pos) state = "done";
    chip.dataset.state = state;
    chip.dataset.team = isEnemySide(k) ? "enemy" : "mine";
    chip.dataset.me = String(k === myKey);
    chip.append(
      el("span", "to-no", String(i + 1)),
      el("span", "to-mon", (state === "skip" && roundStartNames[k]) || activeOf(room, k)?.name || "-"),
      el("span", "to-owner", displayName(k, room)),
    );
    if (room[`${k}_roll`] != null) chip.append(el("span", "to-roll", `${room[`${k}_roll`]}`));
    bar.append(chip);
  });

  for (const k of DOUBLE_SIDES) $(`slot-${k}`)?.classList.toggle("is-turn", room.battle_turn === k && !isAnimating);
}

// ---- 로그 타이핑 + 전투 연출 시퀀서 (싱글배틀과 같은 방식) ----
const LOG_MAX_LINES = 8;
const LOG_TYPE_CHAR_MS = 18;
const LOG_TYPE_GAP_MS = 80;
const HIT_ANIM_DELAY_MS = 350;

let renderedLogCount = 0;
let renderedEventCount = 0;
let boardInitialized = false;
let boardQueue = [];
let boardBusy = false;
let queuedIdx = {}; // 연출 큐에 마지막으로 반영된 자리별 출전 포켓몬 번호 (교체 연출 순서 추적)

function trimLogLines(node) {
  while (node.children.length > LOG_MAX_LINES) node.removeChild(node.firstChild);
}

function appendLogLineInstant(node, text) {
  const div = document.createElement("div");
  div.textContent = text;
  node.appendChild(div);
  trimLogLines(node);
}

function typeLogLine(text, onDone) {
  const node = $("battle-log");
  if (!node) { onDone(); return; }
  const div = document.createElement("div");
  node.appendChild(div);
  const chars = [...text];
  let i = 0;
  function typeNext() {
    if (i >= chars.length) {
      trimLogLines(node);
      onDone();
      return;
    }
    div.textContent += chars[i++];
    node.scrollTop = node.scrollHeight;
    setTimeout(typeNext, LOG_TYPE_CHAR_MS);
  }
  typeNext();
}

let lastStepKind = null;

function describeImpact(step) {
  const before = shownPokemon[step.side];
  const following = [];
  for (const s of boardQueue) {
    if (s.kind === "hit") break;
    if (s.kind === "log") following.push(s.text);
  }
  const text = following.join("\n");
  const effect = /효과가 없는/.test(text) ? "none"
    : /효과가 굉장했다/.test(text) ? "super"
    : /효과가 별로인/.test(text) ? "weak"
    : "normal";
  return {
    hpBefore: before?.hp ?? step.pkmn.hp,
    hpAfter: step.pkmn.hp,
    maxHp: step.pkmn.maxHp || 1,
    hidden: isEnemySide(step.side),
    effect,
    crit: /급소에 맞았다/.test(text),
    attacker: !!step.hasAttacker,
  };
}

function processBoardQueue() {
  if (boardBusy) return;
  if (boardQueue.length === 0) return;
  boardBusy = true;
  const step = boardQueue.shift();
  const next = () => {
    lastStepKind = step.kind;
    boardBusy = false;
    setTimeout(processBoardQueue, LOG_TYPE_GAP_MS);
  };

  if (step.kind === "log") {
    typeLogLine(step.text, next);
    return;
  }

  if (step.kind === "hit") {
    if (step.hasAttacker && lastStepKind !== "hit") document.dispatchEvent(new Event("battle:attack"));
    const impact = describeImpact(step);
    setTimeout(() => {
      document.dispatchEvent(new CustomEvent("battle:impact", { detail: impact }));
      const playEffect = step.hasAttacker ? triggerAttackEffect(step.attacker, step.side) : triggerBlink(step.side);
      playEffect.then(() => {
        applyPokemonVisual(step.side, step.pkmn);
        next();
      });
    }, HIT_ANIM_DELAY_MS);
    return;
  }

  if (step.kind === "heal") {
    const shown = shownPokemon[step.side];
    if (shown) applyPokemonVisual(step.side, { ...shown, hp: step.hp });
    next();
    return;
  }

  if (step.kind === "status") {
    const stats = $(`stats-${step.side}`);
    const shown = shownPokemon[step.side];
    if (stats && shown) {
      shownPokemon[step.side] = { ...shown, status: step.status };
      stats.innerText = formatPokemonName(shownPokemon[step.side]);
    }
    next();
    return;
  }

  if (step.kind === "dice") {
    diceRolling = true;
    roundStartNames = step.names;
    if (latestRoom) renderTurnOrder(latestRoom);
    playDiceRoll(step.rolls).then(() => {
      diceRolling = false;
      diceQueued = Math.max(0, diceQueued - 1);
      isAnimating = diceQueued > 0;
      if (latestRoom) renderTurnUI(latestRoom);
      next();
    });
    return;
  }

  if (step.kind === "switch") {
    updatePortrait(step.side, step.pkmn, true);
    applyPokemonVisual(step.side, step.pkmn);
    setTimeout(next, 400);
    return;
  }

  next();
}

function renderLogAndBoard(room, isNewRound = false) {
  const node = $("battle-log");
  if (!node) return;

  const log = room.battle_log ?? [];
  const events = room.battle_event_log ?? [];

  if (log.length < renderedLogCount) {
    // 새 전투 등으로 로그가 리셋된 경우
    node.innerHTML = "";
    renderedLogCount = 0;
    renderedEventCount = 0;
    boardInitialized = false;
    boardQueue = [];
    boardBusy = false;
    diceQueued = 0;
    isAnimating = false;
    lastQueuedRound = 0;
  }

  const finalIdx = Object.fromEntries(DOUBLE_SIDES.map((k) => [k, room[`${k}_active_idx`] ?? 0]));
  const entryOf = (k, idx) => room[`${k}_entry`]?.[idx] ?? null;

  if (!boardInitialized) {
    if (!entriesReady(room)) return; // 포켓몬 선택이 끝난 뒤에 처음 그린다
    // 최초 진입/재접속: 기존 로그는 연출 없이 즉시 표시. 새 라운드면 마지막 줄("~의 선공!")은 주사위 뒤에
    const holdLast = isNewRound && log.length > 0;
    const visibleLog = holdLast ? log.slice(0, -1) : log;

    node.innerHTML = "";
    visibleLog.slice(-LOG_MAX_LINES).forEach((line) => appendLogLineInstant(node, line));
    node.scrollTop = node.scrollHeight;
    renderedLogCount = log.length;
    renderedEventCount = events.length;
    if (isNewRound) {
      boardQueue.push(diceStep(room));
      if (holdLast) boardQueue.push({ kind: "log", text: log[log.length - 1] });
    }

    for (const k of DOUBLE_SIDES) {
      const pkmn = entryOf(k, finalIdx[k]);
      applyPokemonVisual(k, pkmn);
      updatePortrait(k, pkmn, false);
    }
    queuedIdx = { ...finalIdx };
    boardInitialized = true;
    processBoardQueue();
    return;
  }

  if (log.length === renderedLogCount) {
    if (isNewRound) { boardQueue.push(diceStep(room)); processBoardQueue(); }
    return;
  }

  const startIdx = renderedLogCount;
  const newLines = log.slice(renderedLogCount);
  const newEvents = events.slice(renderedEventCount);
  renderedLogCount = log.length;
  renderedEventCount = events.length;

  // 새 라운드면 마지막 줄(항상 "~의 선공!")은 주사위 연출 뒤에 재생
  const holdLastLine = isNewRound && newLines.length > 0;
  const linesToQueue = holdLastLine ? newLines.slice(0, -1) : newLines;
  const steps = [];

  linesToQueue.forEach((text, i) => {
    steps.push({ kind: "log", text });
    const absoluteIdx = startIdx + i;
    for (const ev of newEvents) {
      if (ev.logIndex !== absoluteIdx) continue;
      const k = ev.side;
      if (ev.type === "hit") {
        // 피격 시점에 그 자리에 나와 있던 포켓몬 (같은 요청 안에서 교체가 이어질 수 있음)
        const base = entryOf(k, queuedIdx[k] ?? finalIdx[k]);
        const hitPkmn = { ...base, hp: ev.hp };
        if ("status" in ev) hitPkmn.status = ev.status;
        steps.push({ kind: "hit", side: k, pkmn: hitPkmn, hasAttacker: ev.hasAttacker, attacker: ev.attacker ?? null });
      } else if (ev.type === "heal") {
        steps.push({ kind: "heal", side: k, hp: ev.hp });
      } else if (ev.type === "status") {
        steps.push({ kind: "status", side: k, status: ev.status });
      } else if (ev.type === "switch") {
        queuedIdx[k] = ev.idx;
        steps.push({ kind: "switch", side: k, pkmn: entryOf(k, ev.idx) });
      }
    }
  });
  queuedIdx = { ...finalIdx };
  if (isNewRound) {
    steps.push(diceStep(room));
    if (holdLastLine) steps.push({ kind: "log", text: newLines[newLines.length - 1] });
  }
  boardQueue.push(...steps);
  processBoardQueue();
}

function renderTurn(room) {
  const node = $("turn-indicator");
  if (room.battle_winner) {
    node.innerText = "배틀 종료";
    return;
  }

  const pendingSides = DOUBLE_SIDES.filter((k) => room[`${k}_pending_switch`]);
  if (pendingSides.length > 0) {
    if (myKey && pendingSides.includes(myKey)) node.innerText = "교체할 포켓몬을 선택!";
    else node.innerText = `${pendingSides.map((k) => displayName(k, room)).join(", ")} 교체 대기 중...`;
    return;
  }

  if (!room.battle_turn) {
    node.innerText = "선공 결정 중...";
    return;
  }
  if (pick && room.battle_turn === myKey) {
    node.innerText = pick.needTarget && !pick.target ? "공격할 대상을 선택!" : "유턴 후 교체할 포켓몬을 선택!";
    return;
  }
  node.innerText = room.battle_turn === myKey ? "나의 턴!" : `${displayName(room.battle_turn, room)}의 턴`;
}

function renderResult(room) {
  const node = $("result");
  const winner = room.battle_winner;
  if (!winner) {
    node.innerText = "";
    return;
  }
  if (winner === "draw") node.innerText = "무승부";
  else if (myKey) node.innerText = teamOf(myKey) === winner ? "승리!" : "패배...";
  else node.innerText = `${teamName(winner, room)} 승리!`;
}

// ---- 주사위: 필드의 포켓몬 수만큼 동시에 굴려서 저장된 값으로 착지 ----
function animateOneDice(node, finalValue) {
  return new Promise((resolve) => {
    let elapsed = 0;
    const interval = 10;
    const duration = 1200;
    const timer = setInterval(() => {
      node.textContent = Math.floor(Math.random() * 10) + 1;
      elapsed += interval;
      if (elapsed >= duration) {
        clearInterval(timer);
        node.textContent = finalValue;
        node.classList.remove("pop");
        void node.offsetWidth;
        node.classList.add("pop");
        resolve();
      }
    }, interval);
  });
}

async function playDiceRoll(rolls) {
  const diceRow = $("diceRow");
  diceRow.replaceChildren();
  const numbers = rolls.map(({ k }) => {
    const box = el("div", "dice-box");
    box.dataset.team = isEnemySide(k) ? "enemy" : "mine";
    const name = el("div", "dice-name", displayName(k, latestRoom));
    const num = el("div", "dice-number", "-");
    box.append(name, num);
    diceRow.append(box);
    return num;
  });
  diceRow.style.display = "grid";

  await Promise.all(rolls.map(({ roll }, i) => animateOneDice(numbers[i], roll)));

  diceSound.currentTime = 0;
  diceSound.play().catch(() => {});

  await new Promise((resolve) => setTimeout(resolve, 900));
  diceRow.style.display = "none";
}
