import type { GameState, Phase, PowerId, UnitTypeId } from "../types.js";
import { UNITS, hasFlag } from "../data/units.js";
import { POWERS, TURN_ORDER } from "../data/powers.js";
import { TERRITORY_INDEX, isSea } from "../data/territories.js";
import { neighbours, addUnits, removeUnits } from "./setup.js";
import { collectibleIncome, controlsOwnCapital } from "./income.js";
import { resolveBattle } from "./combat.js";

// ============================================================================
// Turn structure & phase transitions for Global 1940:
//   purchase -> combat_move -> combat -> noncombat_move -> mobilize ->
//   collect_income -> (next power) purchase ...
// Plus mobilization placement rules and the global victory check.
// ============================================================================

const PHASE_ORDER: Phase[] = [
  "purchase",
  "combat_move",
  "combat",
  "noncombat_move",
  "mobilize",
  "collect_income",
];

export function log(state: GameState, text: string): void {
  state.log.push({ round: state.round, power: state.activePower, phase: state.phase, text });
  if (state.log.length > 500) state.log.splice(0, state.log.length - 500);
}

/** Advance to the next phase, or hand the turn to the next power. */
export function advancePhase(state: GameState): void {
  const idx = PHASE_ORDER.indexOf(state.phase);

  // Leaving the combat phase: auto-resolve any battles the player didn't open.
  if (state.phase === "combat") {
    for (const b of state.combat.battles) {
      if (!b.resolved) {
        const result = resolveBattle(state, b.territory);
        b.resolved = true;
        for (const line of result.text) log(state, line);
      }
    }
    state.combat.battles = [];
  }

  // Leaving collect_income: bank IPC and pass the turn.
  if (state.phase === "collect_income") {
    const income = collectibleIncome(state, state.activePower);
    state.treasury[state.activePower] += income;
    log(state, `${POWERS[state.activePower].display} collects ${income} IPC.`);
    endTurn(state);
    return;
  }

  state.phase = PHASE_ORDER[idx + 1];
  log(state, `${POWERS[state.activePower].display} enters the ${labelFor(state.phase)} phase.`);
}

function labelFor(phase: Phase): string {
  return {
    purchase: "purchase",
    combat_move: "combat movement",
    combat: "combat",
    noncombat_move: "non-combat movement",
    mobilize: "mobilize new units",
    collect_income: "collect income",
  }[phase];
}

/** Hand the turn to the next non-eliminated power, advancing the round on wrap. */
function endTurn(state: GameState): void {
  // Clear any unplaced purchases (forfeited if not mobilized).
  state.purchases = [];

  let curIdx = TURN_ORDER.indexOf(state.activePower);
  for (let i = 0; i < TURN_ORDER.length; i++) {
    curIdx = (curIdx + 1) % TURN_ORDER.length;
    if (curIdx === 0) state.round += 1;
    const next = TURN_ORDER[curIdx];
    if (!state.eliminated.includes(next) && isStillInPlay(state, next)) {
      state.activePower = next;
      state.phase = "purchase";
      log(state, `--- Round ${state.round}: ${POWERS[next].display}'s turn ---`);
      checkVictory(state);
      return;
    }
  }
}

/** A power is in play while it controls at least one territory. */
function isStillInPlay(state: GameState, power: PowerId): boolean {
  return Object.values(state.territories).some((t) => t.controller === power);
}

// --- Mobilization -----------------------------------------------------------

/** Territories where `power` may place newly-built units of `type`. */
export function placementOptions(state: GameState, power: PowerId, type: UnitTypeId): string[] {
  const d = UNITS[type];
  const out: string[] = [];

  // Factories controlled by this power (and originally owned by it) anchor
  // production. Structures themselves place onto any controlled territory.
  const factories = Object.values(state.territories).filter(
    (ts) =>
      ts.controller === power &&
      ts.units.some((u) => hasFlag(u.type, "factory") && u.owner === power),
  );

  if (d.domain === "structure") {
    // New factories go onto controlled, originally-owned land lacking one.
    return Object.values(state.territories)
      .filter(
        (ts) =>
          ts.controller === power &&
          !isSea(ts.id) &&
          TERRITORY_INDEX[ts.id].originalOwner === power &&
          !ts.units.some((u) => hasFlag(u.type, "factory")),
      )
      .map((ts) => ts.id);
  }

  for (const f of factories) {
    if (d.domain === "land" || d.domain === "air") {
      out.push(f.id);
    }
    if (d.domain === "sea") {
      // Naval units mobilize into an adjacent friendly sea zone.
      for (const n of neighbours(f.id)) {
        if (isSea(n) && !out.includes(n)) out.push(n);
      }
    }
  }
  return out;
}

export interface PlaceResult {
  ok: boolean;
  reason?: string;
}

export function placeUnit(
  state: GameState,
  power: PowerId,
  type: UnitTypeId,
  territory: string,
): PlaceResult {
  if (state.phase !== "mobilize") return { ok: false, reason: "Units are placed during the mobilize phase." };
  const pending = state.purchases.find((p) => p.type === type && p.count > 0);
  if (!pending) return { ok: false, reason: "No such unit purchased." };
  if (!placementOptions(state, power, type).includes(territory)) {
    return { ok: false, reason: "Cannot place that unit there." };
  }
  pending.count -= 1;
  state.purchases = state.purchases.filter((p) => p.count > 0);
  addUnits(state.territories[territory], type, 1, power);
  log(state, `${POWERS[power].display} mobilizes ${UNITS[type].display} in ${TERRITORY_INDEX[territory].display}.`);
  return { ok: true };
}

// --- Victory ---------------------------------------------------------------

/** Axis/Allies win by holding every enemy capital simultaneously. */
export function checkVictory(state: GameState): void {
  if (state.winner) return;
  const capitals = Object.values(POWERS);
  const axisCapsHeldByAllies = capitals
    .filter((p) => p.alliance === "Axis")
    .every((p) => {
      const c = state.territories[p.capital]?.controller;
      return c && POWERS[c].alliance === "Allies";
    });
  const alliedCapsHeldByAxis = capitals
    .filter((p) => p.alliance === "Allies")
    .every((p) => {
      const c = state.territories[p.capital]?.controller;
      return c && POWERS[c].alliance === "Axis";
    });
  if (axisCapsHeldByAllies) {
    state.winner = "Allies";
    log(state, "ALLIED VICTORY — every Axis capital has fallen.");
  } else if (alliedCapsHeldByAxis) {
    state.winner = "Axis";
    log(state, "AXIS VICTORY — every Allied capital has fallen.");
  }
}

export { controlsOwnCapital };
