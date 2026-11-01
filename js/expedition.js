// js/expedition.js
// 탐사 규칙 정의 + 이벤트 시뮬레이션.
// 탐사 시작 시 seed 하나만 저장하고, 이벤트/로그/보상은 seed로 매번 동일하게 재계산한다.
// → 탐사 도중에는 Firestore 읽기/쓰기가 전혀 발생하지 않는다.
// 조우 이벤트의 배틀도 같은 seed 난수로 계산하므로, 탐사 시작 시 포켓몬 스탯을 함께 저장해둔다(pokemonData).
import { pickWild } from "./wildPokemon.js";
import { runWildBattle } from "./wildBattle.js";

export const SECTORS = {
  "01": { name: "SECTOR 01", difficulty: "★☆☆☆☆", recommend: ["풀", "벌레", "비행"] },
};
export const SECTOR_COUNT = 9; // SECTOR 01 ~ 09 (현재는 01만 사용)

// 탐사 시간(초) → 이벤트 발생 시점(초)
export const DURATIONS = {
  60:  [20, 40],
  180: [60, 90, 120],
  300: [60, 120, 180, 240],
};

export const BERRIES = { oran: "오랭열매", sitrus: "자뭉열매" };
export const EMPTY_BERRIES = { oran: 0, sitrus: 0 };

const LOST_RATE = 0.15;      // 길을 잃을 확률
const ENCOUNTER_RATE = 0.15; // 야생 포켓몬과 마주칠 확률
const LOST_PENALTY = 0.3;    // 길을 잃은 뒤 다음 채집 보상 감소율
const LOSE_HP_RATIO = 0.1;   // 배틀에서 진 뒤 정신을 차렸을 때의 HP (최대 HP 대비)
const DEFAULT_HP = 100;      // 엔트리 데이터에 hp가 없을 때 쓰는 값

// seed 기반 난수 (mulberry32)
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newSeed() {
  return Math.floor(Math.random() * 2147483647);
}

// 탐사 시작 시 저장할 포켓몬 정보 (엔트리가 나중에 바뀌어도 같은 로그가 나오도록 스냅샷으로 저장)
export function pokemonSnapshot(p) {
  return {
    name: p.name,
    type: p.type ?? [],
    hp: Number.isFinite(p.hp) && p.hp > 0 ? p.hp : DEFAULT_HP,
    atk: p.atk ?? 0,
    def: p.def ?? 0,
    spd: p.spd ?? 0,
    moves: (p.moves ?? []).map(m => ({ name: m.name, pp: m.pp ?? 0 })),
  };
}

// 0: 오랭만 / 1: 자뭉만 / 2: 둘 다 — 각각 1~2개. penalized면 LOST_PENALTY만큼 감소
function rollBerries(rand, penalized) {
  const pick = Math.floor(rand() * 3);
  const gain = { oran: 0, sitrus: 0 };
  if (pick !== 1) gain.oran = 1 + Math.floor(rand() * 2);
  if (pick !== 0) gain.sitrus = 1 + Math.floor(rand() * 2);
  if (penalized) {
    for (const k in gain) gain[k] = Math.floor(gain[k] * (1 - LOST_PENALTY));
  }
  return gain;
}

// 탐사 정보({ sector, durationSec, seed, pokemonData }) → 이벤트 목록
// 각 이벤트: { at, type: "lost" }
//          | { at, type: "berry", gain: { oran, sitrus }, penalized }
//          | { at, type: "encounter", wild, result: "win"|"lose"|"flee", battleLog, hp, maxHp, gain?, penalized? }
// 조우 배틀에서 깎인 HP는 탐사가 끝날 때까지 이어진다. 승리하면 채집 1회 추가.
// pokemonData가 없는 예전 탐사 기록은 조우 대신 채집으로 처리한다.
export function simulate(exp) {
  const rand = mulberry32(exp.seed);
  const events = [];
  const fighter = exp.pokemonData ? { ...exp.pokemonData, maxHp: exp.pokemonData.hp } : null;
  let hp = fighter?.maxHp ?? 0;
  let lost = false;

  for (const at of DURATIONS[exp.durationSec] || []) {
    const r = rand();
    if (r < LOST_RATE) {
      lost = true; // 연속으로 길을 잃어도 감소는 중첩되지 않는다
      events.push({ at, type: "lost" });
      continue;
    }

    const wild = fighter && r < LOST_RATE + ENCOUNTER_RATE ? pickWild(exp.sector, rand) : null;
    if (wild) {
      const battle = runWildBattle({ ...fighter, hp }, wild, rand);
      hp = battle.result === "lose" ? Math.max(1, Math.floor(fighter.maxHp * LOSE_HP_RATIO)) : battle.hp;
      const event = { at, type: "encounter", wild: wild.name, result: battle.result, battleLog: battle.log, hp, maxHp: fighter.maxHp };
      if (battle.result === "win") {
        event.penalized = lost;
        event.gain = rollBerries(rand, lost);
        lost = false;
      }
      events.push(event);
      continue;
    }

    events.push({ at, type: "berry", gain: rollBerries(rand, lost), penalized: lost });
    lost = false;
  }
  return events;
}

export function totalGain(events) {
  const total = { ...EMPTY_BERRIES };
  for (const e of events) {
    if (!e.gain) continue;
    for (const k in total) total[k] += e.gain[k];
  }
  return total;
}

export function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? (s ? `${m}분 ${s}초` : `${m}분`) : `${s}초`;
}

function formatBerryGain(e, pokemon) {
  const parts = Object.keys(BERRIES)
    .filter(k => e.gain[k] > 0)
    .map(k => `${BERRIES[k]} +${e.gain[k]}`);
  const penalty = e.penalized ? " (길을 잃어 보상 30% 감소)" : "";
  if (!parts.length) {
    return `${pokemon}이(가) 나무열매를 발견했지만 헤매느라 하나도 챙기지 못했다.${penalty}`;
  }
  return `${pokemon}이(가) 나무열매를 발견했다! ${parts.join(", ")}${penalty}`;
}

// 조우 이벤트는 배틀 로그가 이어지므로 여러 줄(줄바꿈으로 구분)로 반환한다.
export function formatEvent(e, pokemon) {
  const time = `[${formatTime(e.at)}]`;
  if (e.type === "lost") {
    return `${time} ${pokemon}이(가) 길을 잃었다... 다음 채집 보상이 30% 감소한다.`;
  }
  if (e.type === "encounter") {
    const [first, ...rest] = e.battleLog;
    const lines = [`${time} ${first}`, ...rest];
    const hp = `(HP ${e.hp}/${e.maxHp})`;
    if (e.result === "win") {
      lines.push(`승리했다! ${hp}`);
      lines.push(formatBerryGain(e, pokemon));
    } else if (e.result === "lose") {
      lines.push(`${pokemon}은(는) 간신히 정신을 차렸다... ${hp}`);
    } else {
      lines.push(hp);
    }
    return lines.join("\n");
  }
  return `${time} ${formatBerryGain(e, pokemon)}`;
}
