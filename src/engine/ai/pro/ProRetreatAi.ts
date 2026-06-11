/*
 * Ported from TripleA (https://github.com/triplea-game/triplea)
 * games.strategy.triplea.ai.pro.ProRetreatAi — © TripleA contributors.
 * Licensed under the GNU General Public License v3.0 or later.
 *
 * Retreat decision. Java computes a battleValue = tuvSwing + territoryValue
 * (territoryValue only counted when a land unit would remain / no air-only
 * attack) and retreats when battleValue < 0. We mirror that: estimate the odds
 * on the CURRENT forces still in the battle; retreat when the win chance is
 * below minWinPercentage AND the expected TUV swing is negative (a losing,
 * value-destroying fight). Land targets we're about to take with a surviving
 * land unit are never abandoned cheaply.
 */
import type { GameState, PowerId, UnitStack } from "../../types.js";
import { areEnemies } from "../../rules/politics.js";
import { isSea } from "../../data/territories.js";
import { buildProData } from "./ProData.js";
import { estimateAttackOdds } from "./ProOddsCalculator.js";

/** Current attacker/defender stacks still present in the battle territory. */
function currentSides(
  state: GameState,
  territory: string,
  attacker: PowerId,
): { attackers: UnitStack[]; defenders: UnitStack[] } {
  const units = state.territories[territory]?.units ?? [];
  return {
    attackers: units
      .filter((u) => u.owner === attacker && u.count > 0)
      .map((u) => ({ type: u.type, owner: u.owner, count: u.count })),
    defenders: units
      .filter((u) => areEnemies(state, u.owner, attacker) && u.count > 0)
      .map((u) => ({ type: u.type, owner: u.owner, count: u.count })),
  };
}

/**
 * shouldRetreat — true when the attacker should withdraw rather than fight on.
 * Amphibious assaults can't retreat (engine rule), so always fight those.
 */
export function shouldRetreat(state: GameState, territory: string, attacker: PowerId): boolean {
  const battle = state.combat.battles.find((b) => b.territory === territory);
  if (!battle || battle.resolved) return false;
  if (battle.amphibious) return false;

  const pd = buildProData(state, attacker);
  const { attackers, defenders } = currentSides(state, territory, attacker);
  if (attackers.length === 0) return false; // nothing left to retreat
  if (defenders.length === 0) return false; // already won the ground

  const result = estimateAttackOdds(state, territory, attacker, attackers, defenders, 1);
  const sea = isSea(territory);
  const landOk = sea || result.hasLandUnitRemaining;

  // battleValue < 0  ⇔  poor odds and we're bleeding value (or can't hold land).
  const losing = result.winPercentage < pd.minWinPercentage;
  const valueNegative = result.tuvSwing < 0;
  return losing && (valueNegative || !landOk);
}
