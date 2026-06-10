import type { GameState, PowerId, TerritoryState } from "../types.js";
import { POWERS, areEnemies } from "../data/powers.js";

// ============================================================================
// Territory control changes shared by combat (conquest) and movement (walking
// into undefended enemy land, liberating an ally's land, or annexing a
// neutral). Capturing an enemy capital loots its treasury.
// ============================================================================

export function captureTerritory(
  state: GameState,
  ts: TerritoryState,
  conqueror: PowerId,
  notes: string[],
): void {
  const previous = ts.controller;
  ts.controller = conqueror;
  ts.factoryDamage = 0;
  notes.push(`${POWERS[conqueror].display} takes control of ${ts.id}.`);

  for (const p of Object.values(POWERS)) {
    if (p.capital === ts.id && previous && areEnemies(conqueror, previous)) {
      const looted = state.treasury[previous] ?? 0;
      if (looted > 0) {
        state.treasury[conqueror] += looted;
        state.treasury[previous] = 0;
        notes.push(`${POWERS[conqueror].display} loots ${looted} IPC from ${POWERS[previous].display}'s capital!`);
      }
    }
  }
}
