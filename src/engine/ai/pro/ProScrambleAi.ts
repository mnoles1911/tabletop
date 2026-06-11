/*
 * Ported from TripleA (https://github.com/triplea-game/triplea)
 * games.strategy.triplea.ai.pro.ProScrambleAi — © TripleA contributors.
 * Licensed under the GNU General Public License v3.0 or later.
 *
 * Scramble decision. Java scrambles aircraft into a sea battle when doing so
 * meaningfully improves the defender's expected outcome (the scrambled-air
 * defence result beats the no-scramble result by a margin). We estimate both
 * with the odds calculator (attacker win% with vs without the scrambled air on
 * defence) and scramble when it lowers the attacker's win chance enough to
 * matter — i.e. it can flip or seriously dent the battle.
 */
import type { GameState, PowerId, UnitStack, UnitTypeId } from "../../types.js";
import { areEnemies } from "../../rules/politics.js";
import { areAllied } from "../../data/powers.js";
import { isSea } from "../../data/territories.js";
import { neighbours } from "../../rules/setup.js";
import { scrambleSources } from "../../rules/combat.js";
import { estimateAttackOdds } from "./ProOddsCalculator.js";

const SCRAMBLE_TYPES: UnitTypeId[] = ["fighter", "tactical_bomber"];

/** Aircraft (up to 3 per base) the defender could scramble into this sea battle. */
function scramblableAir(state: GameState, territory: string, defender: PowerId, attacker: PowerId): UnitStack[] {
  const out: Record<string, number> = {};
  for (const land of scrambleSources(state, territory, attacker)) {
    const lt = state.territories[land];
    const c = lt.controller;
    if (!c || (c !== defender && !areAllied(c, defender))) continue;
    let budget = 3;
    for (const type of SCRAMBLE_TYPES) {
      if (budget <= 0) break;
      const stack = lt.units.find((u) => u.type === type && u.owner === c);
      const n = Math.min(stack?.count ?? 0, budget);
      if (n <= 0) continue;
      out[type] = (out[type] ?? 0) + n;
      budget -= n;
    }
  }
  return Object.entries(out).map(([type, count]) => ({ type: type as UnitTypeId, owner: defender, count }));
}

/** Current defender stacks already in the sea zone (enemies of the attacker). */
function seaDefenders(state: GameState, territory: string, attacker: PowerId): UnitStack[] {
  return (state.territories[territory]?.units ?? [])
    .filter((u) => areEnemies(state, u.owner, attacker) && u.count > 0)
    .map((u) => ({ type: u.type, owner: u.owner, count: u.count }));
}

function seaAttackers(state: GameState, territory: string, attacker: PowerId): UnitStack[] {
  return (state.territories[territory]?.units ?? [])
    .filter((u) => u.owner === attacker && u.count > 0)
    .map((u) => ({ type: u.type, owner: u.owner, count: u.count }));
}

/**
 * shouldScramble — true if scrambling air improves the defence enough to be
 * worth it. Compares the attacker's win% without scrambled air vs with it; a
 * drop of >= 10 percentage points (or pushing the attacker below a near-certain
 * win) justifies the scramble.
 */
export function shouldScramble(state: GameState, territory: string, defender: PowerId): boolean {
  if (!isSea(territory)) return false;
  const battle = state.combat.battles.find((b) => b.territory === territory);
  if (!battle) return false;
  const attacker = battle.attacker;

  const air = scramblableAir(state, territory, defender, attacker);
  if (air.length === 0) return false;

  const attackers = seaAttackers(state, territory, attacker);
  if (attackers.length === 0) return false;
  const baseDef = seaDefenders(state, territory, attacker);

  const without = estimateAttackOdds(state, territory, attacker, attackers, baseDef, 1);
  // Merge air into the defence (same owner key collapses naturally).
  const withAir = [...baseDef];
  for (const a of air) withAir.push(a);
  const withScramble = estimateAttackOdds(state, territory, attacker, attackers, withAir, 1);

  const improvement = without.winPercentage - withScramble.winPercentage;
  // Worth it if it meaningfully reduces the attacker's chance, or saves ships we
  // would otherwise certainly lose.
  void neighbours;
  return improvement >= 10 || (without.winPercentage >= 90 && withScramble.winPercentage < 80);
}
