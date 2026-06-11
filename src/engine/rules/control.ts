import type { Alliance, GameState, PowerId, TerritoryState } from "../types.js";
import { POWERS, areEnemies } from "../data/powers.js";
import { TERRITORIES } from "../data/territories.js";

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

const opposite = (a: Alliance): Alliance => (a === "Axis" ? "Allies" : "Axis");

/** A live, capital-holding representative power of an alliance (for activated neutrals). */
function representative(state: GameState, side: Alliance): PowerId {
  const preferred: PowerId = side === "Axis" ? "Germany" : "UnitedStates";
  if (!state.eliminated.includes(preferred)) return preferred;
  for (const p of Object.values(POWERS)) {
    if (p.alliance === side && p.id !== "Neutral" && !state.eliminated.includes(p.id)) return p.id;
  }
  return preferred;
}

/**
 * Neutral diplomacy. The first time a power violates a neutral country, its
 * whole bloc is swung into the war (Global 1940 rule):
 *   - pro-Axis neutrals all join the Axis,
 *   - pro-Allied neutrals all join the Allies,
 *   - strict neutrals all join the alliance OPPOSING the aggressor.
 * Their garrisons (owned by the synthetic "Neutral" power) become that side's
 * units and their territories come under that side's control. Returns whether
 * the joining side is friendly to the aggressor (a peaceful activation) or
 * hostile (the aggressor must now fight them). No-op if already activated.
 */
export function activateNeutralBloc(
  state: GameState,
  enteredTerritory: string,
  aggressor: PowerId,
): "friendly" | "hostile" | null {
  const bloc = TERRITORIES.find((t) => t.id === enteredTerritory)?.neutral;
  if (!bloc) return null;
  const done = state.neutralsActivated ?? (state.neutralsActivated = []);
  if (done.includes(bloc)) {
    // Bloc already swung; just report the relationship for the entered terr.
    const ctrl = state.territories[enteredTerritory].controller;
    return ctrl && !areEnemies(ctrl, aggressor) ? "friendly" : "hostile";
  }

  const side: Alliance = bloc === "axis" ? "Axis" : bloc === "allies" ? "Allies" : opposite(POWERS[aggressor].alliance);
  const rep = representative(state, side);
  for (const def of TERRITORIES) {
    if (def.neutral !== bloc) continue;
    const ts = state.territories[def.id];
    if (ts.controller) continue; // already a real combatant's
    // Convert the neutral garrison to the joining side and hand over control.
    for (const stack of ts.units) {
      if (stack.owner === "Neutral") stack.owner = rep;
    }
    // Merge any now-duplicate stacks.
    const merged: Record<string, number> = {};
    for (const s of ts.units) merged[`${s.type}:${s.owner}`] = (merged[`${s.type}:${s.owner}`] ?? 0) + s.count;
    ts.units = Object.entries(merged).map(([k, count]) => {
      const [type, owner] = k.split(":");
      return { type: type as never, owner: owner as PowerId, count };
    });
    ts.controller = rep;
  }
  done.push(bloc);
  return POWERS[rep].alliance === POWERS[aggressor].alliance ? "friendly" : "hostile";
}
