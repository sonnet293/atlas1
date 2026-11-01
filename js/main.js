// js/main.js
// Firestore 비용 최소화:
//   - 페이지 진입 시 읽기 2회 (users/{uid}의 entry, idle/{uid}의 게임 상태). 실시간 리스너 없음.
//   - 탐사 시작 1회 쓰기 / 탐사 완료 1회 쓰기 / 인벤토리에 넣기 1회 쓰기.
//   - 탐사 중 이벤트·로그는 seed로 클라이언트에서 계산하므로 추가 읽기/쓰기 없음.
import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  SECTORS, SECTOR_COUNT, BERRIES, EMPTY_BERRIES,
  simulate, totalGain, formatEvent, formatTime, newSeed, pokemonSnapshot,
} from "./expedition.js";

const $ = id => document.getElementById(id);

const CLAIM_BUFFER_MS = 1500; // 서버 시간과의 오차 대비 여유
const CLAIM_RETRY_MS = 5000;

let idleRef = null;
let entry = [];
let state = null; // { storage, inventory, expedition, lastExpedition }
let selectedSector = null;
let busy = false;
let nextClaimAt = 0;

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.href = "index.html";
    return;
  }
  $("userEmail").textContent = user.email || "";
  idleRef = doc(db, "idle", user.uid);

  try {
    const [userSnap, idleSnap] = await Promise.all([
      getDoc(doc(db, "users", user.uid)),
      getDoc(idleRef),
    ]);
    entry = (userSnap.exists() && userSnap.data().entry) || [];

    if (idleSnap.exists()) {
      state = idleSnap.data();
    } else {
      state = {
        storage: { ...EMPTY_BERRIES },
        inventory: { ...EMPTY_BERRIES },
        expedition: null,
        lastExpedition: null,
      };
      await setDoc(idleRef, state);
    }
  } catch (err) {
    console.error(err);
    $("loading").textContent = "데이터를 불러오지 못했습니다.";
    return;
  }

  $("loading").hidden = true;
  $("app").hidden = false;
  renderSectors();
  renderPokemonSelect();
  renderBerries();
  tick();
  setInterval(tick, 1000);
});

$("logoutBtn").addEventListener("click", () => signOut(auth));

// ───── SECTOR ─────
function renderSectors() {
  const list = $("sectorList");
  list.innerHTML = "";
  for (let i = 1; i <= SECTOR_COUNT; i++) {
    const id = String(i).padStart(2, "0");
    const btn = document.createElement("button");
    btn.textContent = `SECTOR ${id}`;
    btn.disabled = !SECTORS[id];
    btn.addEventListener("click", () => selectSector(id));
    list.appendChild(btn);
  }
}

function selectSector(id) {
  selectedSector = id;
  const s = SECTORS[id];
  $("sectorName").textContent = s.name;
  $("sectorDifficulty").textContent = s.difficulty;
  $("sectorRecommend").textContent = s.recommend.join(" / ");
  $("sectorPanel").hidden = false;
  updateStartBtn();
}

function renderPokemonSelect() {
  const sel = $("pokemonSelect");
  sel.innerHTML = "";
  if (!entry.length) {
    sel.innerHTML = `<option value="">엔트리에 포켓몬이 없습니다</option>`;
    return;
  }
  entry.forEach((p, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    const types = Array.isArray(p.type) ? p.type.join("/") : (p.type || "");
    opt.textContent = types ? `${p.name} (${types})` : p.name;
    sel.appendChild(opt);
  });
}

function updateStartBtn() {
  $("startBtn").disabled = busy || !!state.expedition || !entry.length || !selectedSector;
}

// ───── 탐사 시작 ─────
$("startBtn").addEventListener("click", async () => {
  const p = entry[$("pokemonSelect").value];
  const durationSec = Number(document.querySelector('input[name="duration"]:checked').value);
  if (!p || !selectedSector || state.expedition) return;

  const exp = {
    sector: selectedSector,
    pokemon: p.name,
    pokemonData: pokemonSnapshot(p),
    durationSec,
    startAt: serverTimestamp(),
    seed: newSeed(),
  };

  busy = true;
  updateStartBtn();
  showMsg("");
  try {
    await updateDoc(idleRef, { expedition: exp });
    // 서버 시각을 다시 읽지 않고 로컬 시각으로 대체 (읽기 1회 절약)
    state.expedition = { ...exp, startAt: Timestamp.now() };
    nextClaimAt = 0;
  } catch (err) {
    console.error(err);
    showMsg("탐사를 시작하지 못했습니다.");
  }
  busy = false;
  updateStartBtn();
  tick();
});

// ───── 매초 갱신: 진행 상황 / 로그 / 완료 처리 ─────
function tick() {
  const exp = state.expedition;
  if (!exp) {
    $("expStatus").textContent = "진행 중인 탐사가 없습니다.";
    renderLog(state.lastExpedition, Infinity, "지난 탐사 로그");
    updateStartBtn();
    return;
  }

  const elapsedSec = Math.max(0, Math.floor((Date.now() - exp.startAt.toMillis()) / 1000));
  const shownSec = Math.min(elapsedSec, exp.durationSec);
  const sector = SECTORS[exp.sector]?.name || exp.sector;

  if (elapsedSec < exp.durationSec) {
    $("expStatus").textContent =
      `${sector} 탐사 중 - ${exp.pokemon} (${formatTime(shownSec)} / ${formatTime(exp.durationSec)})`;
  } else {
    $("expStatus").textContent = `${sector} 탐사 완료! 보상을 정리하는 중...`;
    if (Date.now() >= exp.startAt.toMillis() + exp.durationSec * 1000 + CLAIM_BUFFER_MS) claim();
  }
  renderLog(exp, elapsedSec, "로그");
  updateStartBtn();
}

function renderLog(exp, elapsedSec, title) {
  $("logTitle").textContent = title;
  const list = $("logList");
  list.innerHTML = "";
  if (!exp) return;
  const events = simulate(exp).filter(e => e.at <= elapsedSec);
  if (!events.length) {
    list.innerHTML = "<li>아직 아무 일도 일어나지 않았다.</li>";
    return;
  }
  for (const e of events) {
    const li = document.createElement("li");
    li.textContent = formatEvent(e, exp.pokemon);
    list.appendChild(li);
  }
  if (elapsedSec >= exp.durationSec) {
    const gain = totalGain(simulate(exp));
    const li = document.createElement("li");
    li.textContent = "[결과] " + Object.keys(BERRIES).map(k => `${BERRIES[k]} ${gain[k]}개`).join(", ");
    list.appendChild(li);
  }
}

// ───── 탐사 완료 → 보관함에 보상 추가 ─────
async function claim() {
  if (busy || Date.now() < nextClaimAt) return;
  busy = true;

  const exp = state.expedition;
  const gain = totalGain(simulate(exp));
  const storage = {};
  for (const k in EMPTY_BERRIES) storage[k] = (state.storage[k] || 0) + gain[k];
  const lastExpedition = {
    sector: exp.sector,
    pokemon: exp.pokemon,
    pokemonData: exp.pokemonData ?? null,
    durationSec: exp.durationSec,
    seed: exp.seed,
  };

  try {
    await updateDoc(idleRef, { storage, expedition: null, lastExpedition });
    state.storage = storage;
    state.expedition = null;
    state.lastExpedition = lastExpedition;
    renderBerries();
  } catch (err) {
    // 서버 시간 기준으로 아직 끝나지 않았을 수 있음 → 잠시 후 재시도
    console.error(err);
    nextClaimAt = Date.now() + CLAIM_RETRY_MS;
  }
  busy = false;
  tick();
}

// ───── 보관함 → 인벤토리 ─────
$("storeBtn").addEventListener("click", async () => {
  const inventory = {};
  for (const k in EMPTY_BERRIES) inventory[k] = (state.inventory[k] || 0) + (state.storage[k] || 0);

  $("storeBtn").disabled = true;
  showMsg("");
  try {
    await updateDoc(idleRef, { storage: { ...EMPTY_BERRIES }, inventory });
    state.storage = { ...EMPTY_BERRIES };
    state.inventory = inventory;
  } catch (err) {
    console.error(err);
    showMsg("인벤토리에 넣지 못했습니다.");
  }
  renderBerries();
});

function renderBerries() {
  renderBerryList($("storageList"), state.storage);
  renderBerryList($("inventoryList"), state.inventory);
  $("storeBtn").disabled = !Object.keys(BERRIES).some(k => state.storage[k] > 0);
}

function renderBerryList(list, berries) {
  list.innerHTML = "";
  for (const k in BERRIES) {
    const li = document.createElement("li");
    li.textContent = `${BERRIES[k]} x${berries[k] || 0}`;
    list.appendChild(li);
  }
}

function showMsg(text) {
  $("msg").textContent = text;
}
