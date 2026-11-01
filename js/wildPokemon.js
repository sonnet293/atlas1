// js/wildPokemon.js
// SECTOR별 야생 포켓몬 DB. 조우 이벤트에서 weight 비율로 한 마리가 출몰한다.
// 스탯(hp/atk/def/spd)은 엔트리 포켓몬과 같은 기준이며, moves는 moves.js에 정의된 기술 이름이어야 한다.
// PP는 따로 적지 않으면 WILD_MOVE_PP로 채운다.

export const WILD_MOVE_PP = 10;

export const WILD_POKEMON = {
  // 숲 지대. 풀/벌레/독 위주, 추천 타입(풀/벌레/비행)이 유리하게 싸울 수 있는 구성
  "01": [
    { name: "캐터피", type: ["벌레"],       hp: 100, atk: 3, def: 3, spd: 3, weight: 20,
      moves: ["몸통박치기", "실뿜기", "벌레먹음", "단단해지기"] },
    { name: "뿔충이", type: ["벌레", "독"], hp: 100, atk: 4, def: 3, spd: 4, weight: 18,
      moves: ["독침", "실뿜기", "벌레먹음", "몸통박치기"] },
    { name: "구구",   type: ["노말", "비행"], hp: 110, atk: 4, def: 3, spd: 5, weight: 16,
      moves: ["몸통박치기", "전광석화", "날개치기", "울음소리"] },
    { name: "꼬렛",   type: ["노말"],       hp: 100, atk: 5, def: 3, spd: 6, weight: 14,
      moves: ["몸통박치기", "전광석화", "물기", "꼬리흔들기"] },
    { name: "뚜벅쵸", type: ["풀", "독"],   hp: 120, atk: 4, def: 4, spd: 3, weight: 10,
      moves: ["흡수", "독가루", "용해액", "성장"] },
    { name: "파라스", type: ["벌레", "풀"], hp: 110, atk: 5, def: 4, spd: 2, weight: 8,
      moves: ["할퀴기", "저리가루", "흡수", "벌레먹음"] },
    { name: "콘팡",   type: ["벌레", "독"], hp: 130, atk: 4, def: 4, spd: 4, weight: 6,
      moves: ["몸통박치기", "독가루", "염동력", "실뿜기"] },
    { name: "디그다", type: ["땅"],         hp: 90,  atk: 5, def: 2, spd: 7, weight: 5,
      moves: ["할퀴기", "진흙뿌리기", "땅고르기", "울음소리"] },
    { name: "피카츄", type: ["전기"],       hp: 120, atk: 6, def: 3, spd: 7, weight: 3,
      moves: ["전기쇼크", "전광석화", "볼부비부비", "꼬리흔들기"] },
  ],
};

// 해당 SECTOR의 야생 포켓몬 하나를 weight 비율로 뽑아 배틀용 객체로 만든다. 없으면 null.
export function pickWild(sector, rand) {
  const pool = WILD_POKEMON[sector];
  if (!pool?.length) return null;
  const total = pool.reduce((sum, w) => sum + w.weight, 0);
  let r = rand() * total;
  let picked = pool[pool.length - 1];
  for (const w of pool) {
    r -= w.weight;
    if (r < 0) { picked = w; break; }
  }
  const { weight: _weight, moves, ...stats } = picked;
  return {
    ...stats,
    maxHp: stats.hp,
    moves: moves.map(name => ({ name, pp: WILD_MOVE_PP })),
  };
}
