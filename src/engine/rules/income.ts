import type { GameState, PowerId } from "../types.js";
import { POWERS } from "../data/powers.js";
import { TERRITORY_INDEX } from "../data/territories.js";

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

/** Income actually banked this turn (0 if the capital is in enemy hands). */
export function collectibleIncome(state: GameState, power: PowerId): number {
  if (!controlsOwnCapital(state, power)) return 0;
  return territoryIncome(state, power);
}
