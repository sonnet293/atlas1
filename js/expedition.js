// js/expedition.js
// 탐사 규칙 정의 + 이벤트 시뮬레이션.
// 탐사 시작 시 seed 하나만 저장하고, 이벤트/로그/보상은 seed로 매번 동일하게 재계산한다.
// → 탐사 도중에는 Firestore 읽기/쓰기가 전혀 발생하지 않는다.

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

const LOST_RATE = 0.15;   // 길을 잃을 확률
const LOST_PENALTY = 0.3; // 길을 잃은 뒤 다음 채집 보상 감소율

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

// 탐사 정보({ durationSec, seed }) → 이벤트 목록
// 각 이벤트: { at, type: "lost" } 또는 { at, type: "berry", gain: { oran, sitrus }, penalized }
export function simulate(exp) {
  const rand = mulberry32(exp.seed);
  const events = [];
  let lost = false;

  for (const at of DURATIONS[exp.durationSec] || []) {
    if (rand() < LOST_RATE) {
      lost = true; // 연속으로 길을 잃어도 감소는 중첩되지 않는다
      events.push({ at, type: "lost" });
      continue;
    }
    // 0: 오랭만 / 1: 자뭉만 / 2: 둘 다 — 각각 1~2개
    const pick = Math.floor(rand() * 3);
    const gain = { oran: 0, sitrus: 0 };
    if (pick !== 1) gain.oran = 1 + Math.floor(rand() * 2);
    if (pick !== 0) gain.sitrus = 1 + Math.floor(rand() * 2);

    const penalized = lost;
    if (lost) {
      for (const k in gain) gain[k] = Math.floor(gain[k] * (1 - LOST_PENALTY));
      lost = false;
    }
    events.push({ at, type: "berry", gain, penalized });
  }
  return events;
}

export function totalGain(events) {
  const total = { ...EMPTY_BERRIES };
  for (const e of events) {
    if (e.type !== "berry") continue;
    for (const k in total) total[k] += e.gain[k];
  }
  return total;
}

export function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? (s ? `${m}분 ${s}초` : `${m}분`) : `${s}초`;
}

export function formatEvent(e, pokemon) {
  const time = `[${formatTime(e.at)}]`;
  if (e.type === "lost") {
    return `${time} ${pokemon}이(가) 길을 잃었다... 다음 채집 보상이 30% 감소한다.`;
  }
  const parts = Object.keys(BERRIES)
    .filter(k => e.gain[k] > 0)
    .map(k => `${BERRIES[k]} +${e.gain[k]}`);
  const penalty = e.penalized ? " (길을 잃어 보상 30% 감소)" : "";
  if (!parts.length) {
    return `${time} ${pokemon}이(가) 나무열매를 발견했지만 헤매느라 하나도 챙기지 못했다.${penalty}`;
  }
  return `${time} ${pokemon}이(가) 나무열매를 발견했다! ${parts.join(", ")}${penalty}`;
}
