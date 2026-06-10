import type { GameState, PowerId } from "../types.js";
import { POWERS, areEnemies } from "../data/powers.js";
import { TERRITORY_INDEX, isSea } from "../data/territories.js";
import { neighbours } from "./setup.js";

// ============================================================================
// Economy. A power's income is the sum of the IPC value of every territory it
// controls — but a power that has lost its own capital collects nothing until
// it is liberated (the standard Global 1940 rule).
// ============================================================================

export function controlsOwnCapital(state: GameState, power: PowerId): boolean {
  const capital = POWERS[power].capital;
  return state.territories[capital]?.controller === power;
}

export function territoryIncome(state: GameState, power: PowerId): number {
  let total = 0;
  for (const ts of Object.values(state.territories)) {
    if (ts.controller === power) total += TERRITORY_INDEX[ts.id].ipc;
  }
  return total;
}

// A representative set of National Objectives mapped onto this map's territory
// ids. Each grants bonus IPC while the power controls the listed territories.
// (Gated behind the `nationalObjectives` option; extend freely.)
const NATIONAL_OBJECTIVES: Partial<Record<PowerId, Array<{ bonus: number; controls: string[] }>>> = {
  Germany: [{ bonus: 5, controls: ["russia"] }, { bonus: 3, controls: ["egypt"] }],
  Japan: [{ bonus: 5, controls: ["india"] }, { bonus: 5, controls: ["szechwan"] }],
  Italy: [{ bonus: 5, controls: ["egypt"] }],
  SovietUnion: [{ bonus: 3, controls: ["germany"] }],
  UnitedStates: [{ bonus: 5, controls: ["philippines"] }],
  UnitedKingdom: [{ bonus: 3, controls: ["france"] }],
};

export function nationalObjectiveBonus(state: GameState, power: PowerId): number {
  if (!state.options.nationalObjectives) return 0;
  const objectives = NATIONAL_OBJECTIVES[power] ?? [];
  let bonus = 0;
  for (const o of objectives) {
    if (o.controls.every((id) => state.territories[id]?.controller === power)) bonus += o.bonus;
  }
  return bonus;
}

/**
 * Convoy disruption: enemy warships sitting in a sea zone next to one of your
 * income-producing coastal territories blockade its trade. Each enemy ship cuts
 * 1 IPC, capped at that territory's value.
 */
export function convoyLoss(state: GameState, power: PowerId): number {
  let loss = 0;
  for (const ts of Object.values(state.territories)) {
    if (ts.controller !== power || isSea(ts.id)) continue;
    const value = TERRITORY_INDEX[ts.id].ipc;
    if (value <= 0) continue;
    let enemyShips = 0;
    for (const n of neighbours(ts.id)) {
      if (!isSea(n)) continue;
      enemyShips += state.territories[n].units
        .filter((u) => areEnemies(u.owner, power) && UNIT_IS_WARSHIP(u.type))
        .reduce((s, u) => s + u.count, 0);
    }
    loss += Math.min(value, enemyShips);
  }
  return loss;
}

const WARSHIPS = new Set(["submarine", "destroyer", "cruiser", "battleship", "aircraft_carrier"]);
const UNIT_IS_WARSHIP = (t: string): boolean => WARSHIPS.has(t);

/** Income actually banked this turn (0 if the capital is in enemy hands). */
export function collectibleIncome(state: GameState, power: PowerId): number {
  if (!controlsOwnCapital(state, power)) return 0;
  const gross = territoryIncome(state, power) + nationalObjectiveBonus(state, power);
  return Math.max(0, gross - convoyLoss(state, power));
}
