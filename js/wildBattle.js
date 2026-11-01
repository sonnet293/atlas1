// js/wildBattle.js
// 탐사용 간이 자동 배틀 엔진 (내 포켓몬 1 vs 야생 포켓몬 1).
// 판정 규칙은 js/engine.js의 useMove / 라운드 종료 처리를 그대로 따르되, 다음이 다르다.
//   - 모든 난수는 인자로 받은 rand(seed 기반)를 사용 → 같은 seed면 언제 계산해도 같은 로그가 나온다.
//   - 교체가 없다: 유턴류는 공격만, 울부짖기류는 실패. 장판/날씨 기술은 탐사 중엔 효과가 없다.
//   - 기술은 자동 선택. 내 포켓몬은 상성·위력 위주로 고르고, 야생 포켓몬은 무작위로 고른다.
//   - MAX_ROUNDS 라운드 안에 승부가 나지 않으면 야생 포켓몬이 도망친다.
import { MOVES } from "./moves.js";
import { getTypeMultiplier, pokemonTypes } from "./typeChart.js";
import {
  applyStatus,
  applyVolatile,
  applyEndOfTurnStatusDamage,
  checkActionPrevented,
  checkConfusionInterrupt,
  josa,
} from "./effecthandler.js";

const MAX_ROUNDS = 15;

// 쓸 수 있는 기술이 하나도 없을 때(PP 소진 등) 대신 쓰는 기술. 타입 없음, 필중, 최대 HP 1/4 반동
const STRUGGLE_IDX = -1;
const STRUGGLE = { name: "발버둥", data: { power: 20, type: null, accuracy: 100, alwaysHit: true, effect: { recoilMaxHp: 0.25 } } };

const RANK_MULT_TABLE = [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3];

const RANK_FIELD_MAP = {
  atk: { self: true, stat: "atk" },
  def: { self: true, stat: "def" },
  spd: { self: true, stat: "evasion" },
  targetAtk: { self: false, stat: "atk" },
  targetDef: { self: false, stat: "def" },
  targetSpd: { self: false, stat: "evasion" },
};

// 아래 상수들은 js/engine.js와 같은 값
const FURY_CUTTER_MAX_POWER = 50;
const FURY_CUTTER_MAX_STACK = 2;
const SCREEN_TURNS = 5;
const SCREEN_DAMAGE_MULT = 0.75;
const COUNTER_MULT = 1.5;
const AMULET_TURNS = 5;
const JUMP_KICK_CRASH_RATIO = 1 / 2;
const TRICKSTER_ATK_MULT = 0.7;
const FREEZE_DRY_WATER_MULT = 1.2;
const VENOM_SHOCK_MULT = 1.5;
const CONDITIONAL_POWER_MULT = 1.5;
const GUTS_STATUSES = ["독", "마비", "화상"];
const CHARGE_POWER_MULT = 1.5;
const UNDERGROUND_HIT_MULT = 2;
const BODY_PRESS_SELF_DEF_MULT = 2;
const BODY_PRESS_TARGET_DEF_MULT = 5;
const AQUA_RING_HEAL_RATIO = 1 / 16;
const LEECH_SEED_RATIO = 1 / 8;
const THROAT_CHOP_TURNS = 2;
const SOUND_MOVES = new Set([
  "금속음", "돌림노래", "바크아웃", "소란피기", "싫은소리", "울부짖기",
  "울음소리", "차밍보이스", "비밀이야기", "하이퍼보이스", "매혹의보이스", "벌레의야단법석",
]);
const TRI_ATTACK_STATUSES = ["마비", "화상", "얼음"];
const FUTURE_SIGHT_DELAY = 1;
const WISH_HEAL_RATIO = 0.4;
const TRAP_MIN_TURNS = 4;
const TRAP_MAX_TURNS = 5;
const TRAP_DAMAGE_RATIO = 1 / 16;
const GUARD_REPEAT_CHANCE = 0.33;
const TAUNT_TURNS = 2;

const other = (side) => (side === "me" ? "wild" : "me");
const nameOf = (pokemon) => pokemon?.name ?? "포켓몬";

function moveDataOf(moveName) {
  return moveName === STRUGGLE.name ? STRUGGLE.data : MOVES[moveName];
}

function rollD10(b) {
  return Math.floor(b.rand() * 10) + 1;
}

function clampRank(value) {
  return Math.max(-3, Math.min(3, value));
}

function rankMultiplier(rank) {
  return RANK_MULT_TABLE[clampRank(rank) + 3];
}

function defaultRanks() {
  return {
    atk: { value: 0, expireTurn: 0 },
    def: { value: 0, expireTurn: 0 },
    evasion: { value: 0, expireTurn: 0 },
  };
}

function getEffectiveRank(ranks, stat, currentTurn) {
  const data = ranks?.[stat];
  if (!data) return 0;
  if (currentTurn > data.expireTurn) return 0;
  return data.value;
}

function moveTypeMultiplier(moveData, defender) {
  const types = pokemonTypes(defender);
  return types.reduce((mult, t) => mult * (moveData.freezeDry && t === "물" ? FREEZE_DRY_WATER_MULT : getTypeMultiplier(moveData.type, t)), 1);
}

function hasStab(attacker, moveType) {
  return !!moveType && pokemonTypes(attacker).includes(moveType);
}

function rollAccuracy(b, moveData) {
  if (moveData.alwaysHit) return true;
  return b.rand() < moveData.accuracy / 100;
}

function rollEvasion(b, attacker, defender, defenderRanks) {
  const baseEvasionPct = Math.max(0, Math.min(18, 5 * ((defender.spd ?? 0) - (attacker.spd ?? 0))));
  const evasionRankMult = rankMultiplier(getEffectiveRank(defenderRanks, "evasion", b.turn));
  return b.rand() < Math.max(0, Math.min(100, baseEvasionPct * evasionRankMult)) / 100;
}

function rollCrit(b, attacker) {
  return b.rand() < Math.min(1, (attacker.atk ?? 0) * 0.02);
}

function healRatio(heal) {
  if (typeof heal === "number") return heal;
  return heal?.default ?? 0;
}

function isRecharging(pokemon, currentTurn) {
  return pokemon?.recharge?.turn === currentTurn;
}

function isTaunted(pokemon, currentTurn) {
  const taunt = pokemon?.taunt;
  return !!taunt && currentTurn >= taunt.startTurn && currentTurn <= taunt.expireTurn;
}

function isThroatChopped(pokemon, currentTurn) {
  const tc = pokemon?.throatChop;
  return !!tc && currentTurn >= tc.startTurn && currentTurn <= tc.expireTurn;
}

function isMoveLocked(pokemon, moveName, currentTurn) {
  const lock = pokemon?.moveLock;
  if (lock && lock.name === moveName && lock.turn === currentTurn) return true;
  if (isThroatChopped(pokemon, currentTurn) && SOUND_MOVES.has(moveName)) return true;
  return isTaunted(pokemon, currentTurn) && !((MOVES[moveName]?.power ?? 0) > 0);
}

function targetsOpponent(moveData) {
  if (moveData.power > 0) return true;
  if (moveData.effect?.status || moveData.effect?.volatile) return true;
  if (moveData.taunt || moveData.roar || moveData.leechSeed) return true;
  const rank = moveData.rank ?? {};
  return !!(rank.targetAtk || rank.targetDef || rank.targetSpd);
}

function hitsUnderground(defender, moveData) {
  return !!(defender?.ghostDive?.underground && moveData.hitsUnderground);
}

function diveMessage(name, moveData) {
  if (moveData.dig) return `${name}${josa(name, "은는")} 땅속으로 파고들었다!`;
  if (moveData.bounce) return `${name}${josa(name, "은는")} 높이 뛰어올랐다!`;
  return `${name}${josa(name, "은는")} 어디론가 사라졌다!`;
}

function buildRankChangeMessage(name, statLabel, oldValue, newValue, wasIncrease) {
  const delta = newValue - oldValue;
  if (delta === 0) {
    return wasIncrease
      ? `${name}의 ${statLabel}${josa(statLabel, "은는")} 더 이상 올라가지 않는다!`
      : `${name}의 ${statLabel}${josa(statLabel, "은는")} 더 이상 내려가지 않는다!`;
  }
  if (newValue === 0) return `${name}의 ${statLabel}${josa(statLabel, "이가")} 원래대로 돌아왔다!`;
  if (delta > 0) return `${name}의 ${statLabel}${josa(statLabel, "이가")} ${delta} 상승했다!`;
  return `${name}의 ${statLabel}${josa(statLabel, "이가")} ${-delta} 하락했다!`;
}

function statLabelOf(stat) {
  return stat === "evasion" ? "속도" : stat === "atk" ? "공격" : "방어";
}

function typeEffectMessage(typeMult, defenderName) {
  if (typeMult === 0) return `${defenderName}에게는 효과가 없는 듯하다...`;
  if (typeMult > 1) return "효과가 굉장했다!";
  if (typeMult < 1) return "효과가 별로인 듯하다...";
  return null;
}

// 선공 결정: spd + 1d10 (같으면 다시 굴림)
function decideFirst(b) {
  for (let i = 0; i < 20; i++) {
    const score1 = (b.mons.me.spd ?? 0) + rollD10(b);
    const score2 = (b.mons.wild.spd ?? 0) + rollD10(b);
    if (score1 !== score2) return score1 > score2 ? "me" : "wild";
  }
  return "me";
}

// ───── 기술 자동 선택 ─────

// 내 포켓몬의 기술 선택 가중치. 효과가 없거나 의미 없는 기술은 0.
function moveScore(self, foe, moveData) {
  if (moveData.power > 0) {
    return moveData.power * moveTypeMultiplier(moveData, foe) * (hasStab(self, moveData.type) ? 1.3 : 1);
  }
  if (moveData.effect?.heal) return self.hp * 2 <= (self.maxHp ?? self.hp) ? 50 : 0;
  if (moveData.effect?.status) return foe.status ? 0 : 25;
  if (moveData.effect?.volatile) return foe.volatiles?.[moveData.effect.volatile] ? 0 : 20;
  return 15;
}

function chooseMove(b, side) {
  const self = b.mons[side];
  const foe = b.mons[other(side)];
  const usable = (self.moves ?? [])
    .map((slot, i) => ({ slot, i }))
    .filter(({ slot }) => (slot.pp ?? 0) > 0 && MOVES[slot.name] && !isMoveLocked(self, slot.name, b.turn));
  if (!usable.length) return STRUGGLE_IDX;

  if (side === "wild") return usable[Math.floor(b.rand() * usable.length)].i;

  const scores = usable.map(({ slot }) => moveScore(self, foe, MOVES[slot.name]));
  const total = scores.reduce((sum, s) => sum + s, 0);
  if (total <= 0) return usable[Math.floor(b.rand() * usable.length)].i;
  let r = b.rand() * total;
  for (let k = 0; k < usable.length; k++) {
    r -= scores[k];
    if (r < 0) return usable[k].i;
  }
  return usable[usable.length - 1].i;
}

// ───── 기술 사용 (engine.js의 useMove와 같은 순서로 판정) ─────
function useMove(b, side, moveIdx) {
  const oppSide = other(side);
  const log = b.log;
  const currentTurn = b.turn;
  const attacker = b.mons[side];
  const defender = b.mons[oppSide];

  // 고스트다이브/구멍파기로 사라진 상태면 그 기술로 강제 공격 (PP는 사라질 때 이미 소모)
  const diving = attacker.ghostDive ?? null;
  if (diving) moveIdx = diving.moveIdx;
  const recharging = isRecharging(attacker, currentTurn);

  const moveSlot = moveIdx === STRUGGLE_IDX ? { name: STRUGGLE.name } : attacker.moves[moveIdx];
  const moveData = moveDataOf(moveSlot.name);

  const newMoves = [...(attacker.moves ?? [])];
  if (!diving && !recharging && moveIdx !== STRUGGLE_IDX) newMoves[moveIdx] = { ...moveSlot, pp: moveSlot.pp - 1 };
  let me = { ...attacker, moves: newMoves, charge: null };
  let foe = defender;

  const myRanks = () => b.ranks[side];
  const oppRanks = () => b.ranks[oppSide];

  let furyCutterHit = false;
  let moveConnected = false;
  let guardSucceeded = false;
  let moveMissed = false;
  const defGuard = defender.guard ?? null;
  const an = nameOf(me);
  const dn = nameOf(foe);
  const announce = () => log.push(`${an}의 ${moveSlot.name}!`);

  let blocked = false;
  if (recharging) {
    me = { ...me, recharge: null };
    blocked = true;
    log.push(`${an}${josa(an, "은는")} 공격의 반동으로 움직일 수 없다!`);
  } else {
    const gate = checkActionPrevented(me, b.rand);
    me = gate.pokemon;
    blocked = !gate.canAct;
    if (gate.message) log.push(gate.message);

    if (gate.canAct && me.volatiles?.["혼란"]) {
      const confusion = checkConfusionInterrupt(me, b.rand);
      me = confusion.pokemon;
      if (confusion.message) log.push(confusion.message);
      if (confusion.confused) blocked = true;
    }
  }

  const breaksProtection = !!(diving && moveData.ghostDive);
  if (diving) me = { ...me, ghostDive: null };

  if (blocked) {
    // 행동 저지 (쓰러짐 판정은 runWildBattle에서)
  } else if ((moveData.ghostDive || moveData.dig) && !diving) {
    announce();
    log.push(diveMessage(an, moveData));
    me = { ...me, ghostDive: { moveIdx, underground: !!moveData.dig } };
  } else if (moveData.spikyShield || moveData.defend) {
    announce();
    const chance = me.guardStreak ? GUARD_REPEAT_CHANCE : 1;
    if (b.rand() < chance) {
      const spiky = !!moveData.spikyShield;
      me = { ...me, guard: { name: moveSlot.name, spiky } };
      guardSucceeded = true;
      log.push(spiky ? `${an}${josa(an, "은는")} 가시로 몸을 지켰다!` : `${an}${josa(an, "은는")} 방어 태세에 들어갔다!`);
    } else {
      log.push("그러나 실패했다!");
    }
  } else if (moveData.lightScreen) {
    announce();
    if (me.screen) {
      log.push("그러나 실패했다!");
    } else {
      me = { ...me, screen: { name: moveSlot.name, appliedTurn: currentTurn, expireTurn: currentTurn + SCREEN_TURNS } };
      log.push(`${an}${josa(an, "은는")} ${moveSlot.name}${josa(moveSlot.name, "으로")} 받는 데미지가 줄어들었다!`);
    }
  } else if (moveData.amulet) {
    announce();
    if (me.amulet) {
      log.push("그러나 실패했다!");
    } else {
      me = { ...me, amulet: { expireTurn: currentTurn + AMULET_TURNS } };
      log.push(`${an}${josa(an, "은는")} 신비의 베일에 둘러싸였다!`);
    }
  } else if (moveData.aquaRing) {
    announce();
    if (me.aquaRing) {
      log.push("그러나 실패했다!");
    } else {
      me = { ...me, aquaRing: true };
      log.push(`${an}${josa(an, "은는")} 물의 베일을 둘렀다!`);
    }
  } else if (moveData.futureSight) {
    announce();
    if (b.futureSight[oppSide]) {
      log.push("그러나 실패했다!");
    } else {
      b.futureSight[oppSide] = {
        name: moveSlot.name,
        hitTurn: currentTurn + FUTURE_SIGHT_DELAY,
        power: moveData.power,
        type: moveData.type,
        atk: me.atk,
        attackerTypes: pokemonTypes(me),
      };
      log.push(`${an}${josa(an, "은는")} 미래를 내다보았다!`);
    }
  } else if (moveData.wish) {
    announce();
    if (b.wish[side]) {
      log.push("그러나 실패했다!");
    } else {
      b.wish[side] = { name: an, turn: currentTurn + 1 };
      log.push(`${an}${josa(an, "은는")} 소원을 빌었다!`);
    }
  } else if (moveData.effect?.heal) {
    announce();
    const maxHp = me.maxHp ?? me.hp;
    const heal = Math.min(maxHp - me.hp, Math.max(1, Math.round(maxHp * healRatio(moveData.effect.heal))));
    if (heal > 0) {
      me = { ...me, hp: me.hp + heal };
      log.push(`${an}의 체력이 회복되었다!`);
    } else {
      log.push(`그러나 ${an}의 체력은 가득 차 있다!`);
    }
  } else if (moveData.counter && !me.lastDamageTaken) {
    announce();
    log.push("그러나 실패했다!");
  } else if (defGuard && !defGuard.spiky && moveData.power > 0 && !breaksProtection) {
    announce();
    log.push(`${dn}${josa(dn, "은는")} 공격으로부터 몸을 지켰다!`);
    foe = { ...foe, guard: null };
  } else if (defGuard?.spiky && targetsOpponent(moveData) && !breaksProtection) {
    announce();
    log.push(`${dn}${josa(dn, "은는")} 몸을 지켰다!`);
    foe = { ...foe, guard: null };
    const spikeDmg = Math.max(1, Math.floor((me.maxHp ?? me.hp) / 8));
    me = { ...me, hp: Math.max(0, me.hp - spikeDmg) };
    log.push(`${an}${josa(an, "은는")} 가시에 찔려 데미지를 입었다!`);
  } else if (defender.ghostDive && targetsOpponent(moveData) && !hitsUnderground(defender, moveData)) {
    announce();
    log.push(`${dn}에게는 맞지 않았다!`);
    moveMissed = true;
  } else {
    announce();

    if (breaksProtection && defGuard) {
      foe = { ...foe, guard: null };
      log.push(`${dn}의 ${defGuard.name}${josa(defGuard.name, "이가")} 사라졌다!`);
    }

    if (!rollAccuracy(b, moveData)) {
      log.push(`그러나 ${an}의 공격은 빗나갔다!`);
      moveMissed = true;
    } else if (!moveData.alwaysHit && rollEvasion(b, attacker, defender, oppRanks())) {
      log.push(`${dn}에게는 맞지 않았다!`);
      moveMissed = true;
    } else {
      const atkMult = rankMultiplier(getEffectiveRank(myRanks(), "atk", currentTurn));
      const defMult = rankMultiplier(getEffectiveRank(oppRanks(), "def", currentTurn));
      const typeMult = moveData.type ? moveTypeMultiplier(moveData, defender) : 1;
      const stab = hasStab(attacker, moveData.type) ? 1.3 : 1;
      const atkStat = moveData.trickster ? (defender.atk ?? 0) * TRICKSTER_ATK_MULT : (attacker.atk ?? 0);
      const dmgAtkMult = moveData.trickster ? rankMultiplier(getEffectiveRank(oppRanks(), "atk", currentTurn)) : atkMult;
      const isDamaging = moveData.power > 0;
      moveConnected = typeMult > 0;

      if (moveData.charge) {
        me = { ...me, charge: { turn: currentTurn + 1 } };
        log.push(`${an}${josa(an, "은는")} 몸에 전기를 모았다!`);
      }

      if (moveData.breakBarrier && foe.screen && typeMult > 0) {
        const screenName = foe.screen.name;
        foe = { ...foe, screen: null };
        log.push(`${dn}의 ${screenName}${josa(screenName, "이가")} 깨졌다!`);
      }

      if (isDamaging) {
        let power = moveData.power;
        if (moveData.avalanche && attacker.lastHitRound === currentTurn) power = 70;
        if (moveData.venomShock && defender.status === "독") power = Math.round(power * VENOM_SHOCK_MULT);
        if (moveData.stomping && attacker.missedRound === currentTurn - 1) power = Math.round(power * CONDITIONAL_POWER_MULT);
        if (moveData.guts && GUTS_STATUSES.includes(attacker.status)) power = Math.round(power * CONDITIONAL_POWER_MULT);
        if (moveData.saltWater && defender.hp * 2 <= (defender.maxHp ?? defender.hp)) power = Math.round(power * CONDITIONAL_POWER_MULT);
        if (moveData.sickPower && defender.status) power = Math.round(power * CONDITIONAL_POWER_MULT);
        if (attacker.charge?.turn === currentTurn && moveData.type === "전기") power = Math.round(power * CHARGE_POWER_MULT);
        if (moveData.furyCutter) {
          power = Math.min(FURY_CUTTER_MAX_POWER, moveData.power + 10 * (attacker.furyCutter ?? 0));
          furyCutterHit = true;
        }

        const counterDmg = moveData.counter ? Math.round((attacker.lastDamageTaken ?? 0) * COUNTER_MULT) : null;
        const multiHit = moveData.multiHit;
        const hitCount = multiHit ? multiHit.min + Math.floor(b.rand() * (multiHit.max - multiHit.min + 1)) : 1;
        const screenMult = foe.screen ? SCREEN_DAMAGE_MULT : 1;
        const undergroundMult = hitsUnderground(defender, moveData) ? UNDERGROUND_HIT_MULT : 1;
        let newHp = foe.hp;
        let dmg = 0;
        let hits = 0;
        while (hits < hitCount && newHp > 0) {
          let hitDmg;
          let isCrit = false;
          if (counterDmg !== null) {
            hitDmg = typeMult === 0 ? 0 : counterDmg;
          } else if (multiHit?.fixedDamage) {
            hitDmg = typeMult === 0 ? 0 : multiHit.fixedDamage;
          } else {
            const rawDamage = moveData.bodyPress
              ? (power + (attacker.def ?? 0) * BODY_PRESS_SELF_DEF_MULT * rankMultiplier(getEffectiveRank(myRanks(), "def", currentTurn)) + rollD10(b)) * typeMult * stab -
                (defender.def ?? 0) * BODY_PRESS_TARGET_DEF_MULT * defMult
              : (power + atkStat * 4 + rollD10(b)) * dmgAtkMult * typeMult * stab - (defender.def ?? 0) * 3 * defMult;
            isCrit = rollCrit(b, attacker);
            hitDmg = Math.max(0, Math.round(rawDamage * (isCrit ? 1.5 : 1) * screenMult * undergroundMult));
          }
          newHp = Math.max(0, newHp - hitDmg);
          dmg += hitDmg;
          hits++;
          if (isCrit && hitDmg > 0) log.push("급소에 맞았다!");
          if (typeMult === 0) break;
        }

        foe = { ...foe, hp: newHp, lastHitRound: currentTurn, lastDamageTaken: dmg };

        const effectMsg = typeEffectMessage(typeMult, dn);
        if (effectMsg) log.push(effectMsg);
        if (multiHit && typeMult > 0) log.push(`${hits}번 맞았다!`);

        if (moveData.effect?.drain && dmg > 0) {
          const maxHp = me.maxHp ?? me.hp;
          const heal = Math.min(maxHp - me.hp, Math.max(1, Math.round(dmg * moveData.effect.drain)));
          if (heal > 0) {
            me = { ...me, hp: me.hp + heal };
            log.push(`${dn}의 체력을 흡수했다!`);
          }
        }

        if (moveData.effect?.recoil && dmg > 0) {
          const recoilDmg = Math.max(1, Math.round(dmg * moveData.effect.recoil));
          me = { ...me, hp: Math.max(0, me.hp - recoilDmg) };
          log.push(`${an}${josa(an, "은는")} 반동으로 데미지를 입었다!`);
        }

        if (moveData.effect?.recoilMaxHp) {
          const recoilDmg = Math.max(1, Math.round((me.maxHp ?? me.hp) * moveData.effect.recoilMaxHp));
          me = { ...me, hp: Math.max(0, me.hp - recoilDmg) };
          log.push(`${an}${josa(an, "은는")} 반동으로 데미지를 입었다!`);
        }
      }

      // 장판/날씨: 탐사 중에는 효과 없음 (변화기일 때만 실패 로그)
      if ((moveData.field || moveData.effect?.weather) && !isDamaging) log.push("그러나 아무 일도 일어나지 않았다!");

      if (moveData.strengthSap) {
        const maxHp = me.maxHp ?? me.hp;
        const sapMult = typeof moveData.strengthSap === "number" ? moveData.strengthSap : 1;
        const heal = Math.min(maxHp - me.hp, Math.max(0, Math.round((defender.atk ?? 0) * sapMult)));
        if (heal > 0) {
          me = { ...me, hp: me.hp + heal };
          log.push(`${dn}의 힘을 흡수했다!`);
        } else {
          log.push(`그러나 ${an}의 체력은 가득 차 있다!`);
        }
      }

      if (isDamaging && typeMult > 0 && moveData.effect?.thawEnemy && foe.hp > 0 && foe.status === "얼음") {
        foe = { ...foe, status: null, statusData: {} };
        log.push(`${dn}의 얼음이 녹았다!`);
      }

      // 상태이상 / 상태변화 부여
      let effectBlocked = false;
      if (moveData.effect && (moveData.effect.status || moveData.effect.triAttack || moveData.effect.volatile)) {
        if (isDamaging) {
          effectBlocked = typeMult === 0 || foe.hp <= 0;
        } else if ((moveData.typeImmune && typeMult === 0) || (moveData.poisonPowder && pokemonTypes(foe).includes("풀"))) {
          effectBlocked = true;
          log.push(`${dn}에게는 효과가 없는 듯하다...`);
        }
      }

      if (moveData.effect?.chance && !effectBlocked && b.rand() < moveData.effect.chance) {
        const statusName = moveData.effect.triAttack
          ? TRI_ATTACK_STATUSES[Math.floor(b.rand() * TRI_ATTACK_STATUSES.length)]
          : moveData.effect.status;
        if (statusName) {
          const statusResult = applyStatus(foe, statusName, currentTurn);
          foe = statusResult.pokemon;
          if (statusResult.message && (statusResult.applied || !isDamaging)) log.push(statusResult.message);
        } else if (moveData.effect.volatile) {
          const volName = moveData.effect.volatile;
          if (foe.volatiles?.[volName]) {
            if (!isDamaging) log.push(`${dn}${josa(dn, "은는")} 이미 ${volName} 상태다!`);
          } else {
            foe = applyVolatile(foe, volName, b.rand);
            log.push(`${dn}${josa(dn, "은는")} ${volName} 상태가 되었다!`);
          }
        }
      }

      if (moveData.throatChop && typeMult > 0 && foe.hp > 0) {
        foe = { ...foe, throatChop: { startTurn: currentTurn + 1, expireTurn: currentTurn + THROAT_CHOP_TURNS } };
        log.push(`${dn}${josa(dn, "은는")} 소리 기술을 쓸 수 없게 되었다!`);
      }

      if (moveData.trap && isDamaging && typeMult > 0 && foe.hp > 0 && !foe.trap) {
        const turns = TRAP_MIN_TURNS + Math.floor(b.rand() * (TRAP_MAX_TURNS - TRAP_MIN_TURNS + 1));
        foe = { ...foe, trap: { name: moveSlot.name, expireTurn: currentTurn + turns - 1 } };
        log.push(`${dn}${josa(dn, "은는")} ${moveSlot.name}에 갇혔다!`);
      }

      if (moveData.taunt) {
        if (foe.taunt && currentTurn <= foe.taunt.expireTurn) {
          log.push("그러나 실패했다!");
        } else {
          foe = { ...foe, taunt: { startTurn: currentTurn + 1, expireTurn: currentTurn + TAUNT_TURNS } };
          log.push(`${dn}${josa(dn, "은는")} 도발에 넘어갔다!`);
        }
      }

      if (moveData.leechSeed) {
        if (pokemonTypes(foe).includes("풀")) {
          log.push(`${dn}에게는 효과가 없는 듯하다...`);
        } else if (foe.leechSeed) {
          log.push("그러나 실패했다!");
        } else {
          foe = { ...foe, leechSeed: { side, turn: currentTurn } };
          log.push(`${dn}의 몸에 씨를 심었다!`);
        }
      }

      // 랭크 변화
      if (moveData.rank && !(isDamaging && typeMult === 0) && b.rand() < (moveData.rank.chance ?? 1)) {
        const { turns } = moveData.rank;
        for (const [field, { self, stat }] of Object.entries(RANK_FIELD_MAP)) {
          const value = moveData.rank[field];
          if (!value) continue;
          if (!self && isDamaging && foe.hp <= 0) continue;
          const targetSide = self ? side : oppSide;
          const targetRanks = b.ranks[targetSide];
          const oldValue = getEffectiveRank(targetRanks, stat, currentTurn);
          const newValue = clampRank(oldValue + value);
          b.ranks[targetSide] = { ...targetRanks, [stat]: { value: newValue, expireTurn: currentTurn + turns } };
          log.push(buildRankChangeMessage(self ? an : dn, statLabelOf(stat), oldValue, newValue, value > 0));
        }
      }

      // 울부짖기류: 교체할 포켓몬이 없으므로 항상 실패
      if (moveData.roar) log.push("그러나 실패했다!");
    }
  }

  // 연속자르기 누적 / 방어류 연속 사용 기록
  me = {
    ...me,
    furyCutter: moveData.furyCutter && furyCutterHit ? Math.min((me.furyCutter ?? 0) + 1, FURY_CUTTER_MAX_STACK) : 0,
    guardStreak: guardSucceeded,
  };

  if (moveMissed) me = { ...me, missedRound: currentTurn };

  // 무릎차기류: 빗나가면 자해
  if (moveData.jumpKick && moveMissed && me.hp > 0) {
    const crash = Math.max(1, Math.floor((me.maxHp ?? me.hp) * JUMP_KICK_CRASH_RATIO));
    me = { ...me, hp: Math.max(0, me.hp - crash) };
    log.push(`${an}${josa(an, "은는")} 의욕이 넘쳐서 땅에 부딪쳤다!`);
  }

  if (moveData.heavyHammer && !blocked) me = { ...me, moveLock: { name: moveSlot.name, turn: currentTurn + 1 } };
  if (moveData.counter && !blocked && me.lastDamageTaken) me = { ...me, lastDamageTaken: 0 };
  if (moveData.hyperBeam && moveConnected && me.hp > 0) me = { ...me, recharge: { turn: currentTurn + 1 } };

  // 상대의 방어류: 이번 행동으로 막지 않았으면 사라짐
  if (foe.guard && foe.hp > 0) {
    log.push(`${dn}의 ${foe.guard.name}${josa(foe.guard.name, "이가")} 풀렸다!`);
    foe = { ...foe, guard: null };
  }

  b.mons[side] = me;
  b.mons[oppSide] = foe;
}

// ───── 라운드 종료 처리 (engine.js의 buildTurnAdvanceUpdate와 같은 순서) ─────
function endOfRound(b) {
  const log = b.log;
  const currentTurn = b.turn;
  const sides = ["me", "wild"];
  const alive = (side) => b.mons[side].hp > 0;

  for (const side of sides) {
    const fs = b.futureSight[side];
    if (!fs || currentTurn < fs.hitTurn) continue;
    b.futureSight[side] = null;
    const pkmn = b.mons[side];
    if (pkmn.hp <= 0) continue;
    const typeMult = pokemonTypes(pkmn).reduce((mult, t) => mult * getTypeMultiplier(fs.type, t), 1);
    const stab = fs.attackerTypes?.includes(fs.type) ? 1.3 : 1;
    const raw = (fs.power + (fs.atk ?? 0) * 4 + rollD10(b)) * typeMult * stab - (pkmn.def ?? 0) * 3;
    const dmg = Math.max(0, Math.round(raw * (pkmn.screen ? SCREEN_DAMAGE_MULT : 1)));
    const n = nameOf(pkmn);
    b.mons[side] = { ...pkmn, hp: Math.max(0, pkmn.hp - dmg) };
    log.push(`${n}${josa(n, "은는")} ${fs.name} 공격을 받았다!`);
    const effectMsg = typeEffectMessage(typeMult, n);
    if (effectMsg) log.push(effectMsg);
  }

  for (const side of sides) {
    const wish = b.wish[side];
    if (!wish || currentTurn < wish.turn) continue;
    b.wish[side] = null;
    const pkmn = b.mons[side];
    if (pkmn.hp <= 0) continue;
    log.push(`${wish.name}의 희망사항이 이루어졌다!`);
    const maxHp = pkmn.maxHp ?? pkmn.hp;
    const heal = Math.min(maxHp - pkmn.hp, Math.max(1, Math.round(maxHp * WISH_HEAL_RATIO)));
    const n = nameOf(pkmn);
    if (heal > 0) {
      b.mons[side] = { ...pkmn, hp: pkmn.hp + heal };
      log.push(`${n}의 체력이 회복되었다!`);
    } else {
      log.push(`그러나 ${n}의 체력은 가득 차 있다!`);
    }
  }

  for (const side of sides) {
    const tick = applyEndOfTurnStatusDamage(b.mons[side], currentTurn);
    if (tick.damage > 0) {
      b.mons[side] = tick.pokemon;
      log.push(tick.message);
    }
  }

  for (const side of sides) {
    const pkmn = b.mons[side];
    if (!pkmn.aquaRing || pkmn.hp <= 0) continue;
    const maxHp = pkmn.maxHp ?? pkmn.hp;
    const heal = Math.min(maxHp - pkmn.hp, Math.max(1, Math.floor(maxHp * AQUA_RING_HEAL_RATIO)));
    if (heal <= 0) continue;
    b.mons[side] = { ...pkmn, hp: pkmn.hp + heal };
    const n = nameOf(pkmn);
    log.push(`${n}${josa(n, "은는")} 아쿠아링으로 체력을 회복했다!`);
  }

  // 씨뿌리기: 심은 다음 라운드부터 2라운드에 한 번 흡수. 1:1이라 회복하는 쪽은 항상 상대 포켓몬
  for (const side of sides) {
    const seeded = b.mons[side];
    const seed = seeded.leechSeed;
    if (!seed || seeded.hp <= 0 || (currentTurn - seed.turn) % 2 !== 1) continue;
    const amount = Math.min(seeded.hp, Math.max(1, Math.floor((seeded.maxHp ?? seeded.hp) * LEECH_SEED_RATIO)));
    b.mons[side] = { ...seeded, hp: seeded.hp - amount };
    const n = nameOf(seeded);
    log.push(`씨뿌리기가 ${n}의 체력을 빼앗는다!`);
    const healer = b.mons[other(side)];
    if (healer.hp > 0) {
      const maxHp = healer.maxHp ?? healer.hp;
      const heal = Math.min(maxHp - healer.hp, amount);
      if (heal > 0) b.mons[other(side)] = { ...healer, hp: healer.hp + heal };
    }
  }

  for (const side of sides) {
    const pkmn = b.mons[side];
    if (!pkmn.trap || pkmn.hp <= 0) continue;
    const n = nameOf(pkmn);
    let updated = pkmn;
    if (currentTurn <= pkmn.trap.expireTurn) {
      const damage = Math.max(1, Math.floor((pkmn.maxHp ?? pkmn.hp) * TRAP_DAMAGE_RATIO));
      updated = { ...updated, hp: Math.max(0, updated.hp - damage) };
      log.push(`${n}${josa(n, "은는")} ${pkmn.trap.name}의 데미지를 입었다!`);
    }
    if (currentTurn >= pkmn.trap.expireTurn && updated.hp > 0) {
      updated = { ...updated, trap: null };
      log.push(`${n}${josa(n, "은는")} ${pkmn.trap.name}에서 벗어났다!`);
    }
    b.mons[side] = updated;
  }

  for (const side of sides) {
    const pkmn = b.mons[side];
    const n = nameOf(pkmn);
    if (pkmn.screen && currentTurn >= pkmn.screen.expireTurn) {
      b.mons[side] = { ...b.mons[side], screen: null };
      log.push(`${n}의 ${pkmn.screen.name}${josa(pkmn.screen.name, "이가")} 사라졌다!`);
    }
    if (pkmn.amulet && currentTurn >= pkmn.amulet.expireTurn) {
      b.mons[side] = { ...b.mons[side], amulet: null };
      log.push(`${n}${josa(n, "을를")} 감싸던 신비의 베일이 사라졌다!`);
    }
    if (pkmn.taunt && currentTurn >= pkmn.taunt.expireTurn) {
      b.mons[side] = { ...b.mons[side], taunt: null };
      log.push(`${n}의 도발 효과가 풀렸다!`);
    }
    if (pkmn.throatChop && currentTurn >= pkmn.throatChop.expireTurn) {
      b.mons[side] = { ...b.mons[side], throatChop: null };
      log.push(`${n}${josa(n, "은는")} 다시 소리 기술을 쓸 수 있게 되었다!`);
    }
  }

  for (const side of sides) {
    if (!alive(side)) continue;
    const ranks = b.ranks[side];
    for (const stat of ["atk", "def", "evasion"]) {
      const data = ranks[stat];
      if (!data || data.value === 0 || currentTurn < data.expireTurn) continue;
      b.ranks[side] = { ...b.ranks[side], [stat]: { value: 0, expireTurn: 0 } };
      const label = statLabelOf(stat);
      log.push(`${nameOf(b.mons[side])}의 ${label}${josa(label, "이가")} 원래대로 돌아왔다!`);
    }
  }
}

// order 순서대로 쓰러짐을 판정해 로그를 남긴다. 먼저 쓰러진 쪽이 진 것으로 본다.
// 반환: "win" | "lose" | null(둘 다 서 있음)
function resolveFaint(b, order) {
  let loser = null;
  for (const side of order) {
    if (b.mons[side].hp > 0) continue;
    const n = nameOf(b.mons[side]);
    b.log.push(`${n}${josa(n, "은는")} 쓰러졌다!`);
    loser ??= side;
  }
  if (!loser) return null;
  return loser === "wild" ? "win" : "lose";
}

// 내 포켓몬 vs 야생 포켓몬 자동 배틀.
// me / wild: { name, type, hp, maxHp, atk, def, spd, moves: [{ name, pp }] }
// rand: 0 이상 1 미만을 돌려주는 난수 함수 (seed 기반이면 결과가 재현됨)
// 반환: { result: "win" | "lose" | "flee", log: string[], hp: 배틀 후 내 포켓몬의 남은 HP }
export function runWildBattle(me, wild, rand) {
  const b = {
    rand,
    turn: 1,
    log: [],
    mons: {
      me: { ...me, maxHp: me.maxHp ?? me.hp, status: null, statusData: {}, volatiles: {} },
      wild: { ...wild, maxHp: wild.maxHp ?? wild.hp, status: null, statusData: {}, volatiles: {} },
    },
    ranks: { me: defaultRanks(), wild: defaultRanks() },
    wish: { me: null, wild: null },
    futureSight: { me: null, wild: null },
  };
  const finish = (result) => ({ result, log: b.log, hp: Math.max(0, b.mons.me.hp) });

  const wn = nameOf(wild);
  b.log.push(`앗! 야생의 ${wn}${josa(wn, "이가")} 나타났다!`);

  for (; b.turn <= MAX_ROUNDS; b.turn++) {
    const first = decideFirst(b);
    b.log.push(`${nameOf(b.mons[first])}의 선공!`);
    for (const side of [first, other(first)]) {
      useMove(b, side, chooseMove(b, side));
      const result = resolveFaint(b, [other(side), side]);
      if (result) return finish(result);
    }
    endOfRound(b);
    const result = resolveFaint(b, ["me", "wild"]);
    if (result) return finish(result);
  }

  b.log.push(`야생의 ${wn}${josa(wn, "은는")} 도망쳤다!`);
  return finish("flee");
}
