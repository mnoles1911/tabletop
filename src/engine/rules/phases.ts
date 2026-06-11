import type { GameState, Phase, PowerId, UnitTypeId } from "../types.js";
import { UNITS, hasFlag } from "../data/units.js";
import { POWERS, TURN_ORDER } from "../data/powers.js";
import { TERRITORY_INDEX, isSea } from "../data/territories.js";
import { neighbours, addUnits, removeUnits } from "./setup.js";
import { collectibleIncome, controlsOwnCapital } from "./income.js";
import { resolveBattle } from "./combat.js";
import { rollDie } from "./rng.js";
import { hasTech } from "./research.js";

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

  // Leaving non-combat movement: any of this power's aircraft that failed to
  // reach a safe landing spot are lost (planes must land).
  if (state.phase === "noncombat_move") {
    enforceAirLanding(state, state.activePower);
  }

  // Leaving collect_income: bank IPC and pass the turn.
  if (state.phase === "collect_income") {
    const power = state.activePower;
    let income = collectibleIncome(state, power);
    if (controlsOwnCapital(state, power) && hasTech(state, power, "war_bonds")) {
      const bond = rollDie(state);
      income += bond;
      log(state, `${POWERS[power].display} War Bonds yield ${bond} IPC.`);
    }
    state.treasury[power] += income;
    log(state, `${POWERS[power].display} collects ${income} IPC.`);
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
  // Clear any unplaced purchases (forfeited if not mobilized) and per-turn scratch.
  state.purchases = [];
  state.transportUse = {};
  state.placement = {};

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

/**
 * Planes must land. An air unit is safe on friendly-controlled land, or in a
 * sea zone holding a friendly aircraft carrier. Aircraft that end the turn
 * stranded (over the sea with no carrier, or over enemy/neutral land) are lost.
 */
export function enforceAirLanding(state: GameState, power: PowerId): void {
  for (const ts of Object.values(state.territories)) {
    const air = ts.units.filter((u) => u.owner === power && UNITS[u.type].domain === "air");
    if (air.length === 0) continue;

    let safe: boolean;
    if (isSea(ts.id)) {
      safe = ts.units.some((u) => u.type === "aircraft_carrier" && (u.owner === power || POWERS[u.owner].alliance === POWERS[power].alliance));
    } else {
      const c = ts.controller;
      safe = !!c && (c === power || POWERS[c].alliance === POWERS[power].alliance);
    }
    if (safe) continue;

    for (const u of air) {
      log(state, `${POWERS[power].display} loses ${u.count}× ${UNITS[u.type].display} — nowhere to land in ${TERRITORY_INDEX[ts.id].display}.`);
    }
    ts.units = ts.units.filter((u) => !(u.owner === power && UNITS[u.type].domain === "air"));
  }
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
    // Structures place onto controlled, originally-owned land. Factories need a
    // factory-free territory; air bases need an air-base-free one; naval bases
    // need air-base-free *coastal* land (adjacent to a sea zone).
    const flag = type === "air_base" ? "air_base" : type === "naval_base" ? "naval_base" : "factory";
    return Object.values(state.territories)
      .filter((ts) => {
        if (ts.controller !== power || isSea(ts.id)) return false;
        if (TERRITORY_INDEX[ts.id].originalOwner !== power) return false;
        if (ts.units.some((u) => hasFlag(u.type, flag))) return false;
        if (type === "naval_base" && !neighbours(ts.id).some((n) => isSea(n))) return false;
        return true;
      })
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

/** A factory's base production capacity before strategic-bombing damage. */
export function factoryCapacity(state: GameState, power: PowerId, territory: string): number {
  const ts = state.territories[territory];
  const major = ts.units.some((u) => u.type === "major_ic" && u.owner === power);
  const minor = ts.units.some((u) => u.type === "minor_ic" && u.owner === power);
  if (!major && !minor) return 0;
  let base = major ? Math.max(1, TERRITORY_INDEX[territory].ipc) : 3;
  if (hasTech(state, power, "increased_factory")) base += 2;
  const damage = ts.factoryDamage ?? 0;
  return Math.max(0, base - damage);
}

/** Units this factory may still place this turn. */
export function remainingCapacity(state: GameState, power: PowerId, territory: string): number {
  return factoryCapacity(state, power, territory) - (state.placement[territory] ?? 0);
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

  // Combat units & aircraft are limited by the factory's production capacity.
  // (New industrial complexes themselves are exempt — one per territory.)
  if (UNITS[type].domain !== "structure") {
    // For naval units the limiting factory is the coastal one feeding this sea zone.
    const factoryTerr = isSea(territory)
      ? neighbours(territory).find((n) => !isSea(n) && remainingCapacity(state, power, n) > 0)
      : territory;
    if (!factoryTerr || remainingCapacity(state, power, factoryTerr) <= 0) {
      return { ok: false, reason: "That factory has no production capacity left this turn." };
    }
    state.placement[factoryTerr] = (state.placement[factoryTerr] ?? 0) + 1;
  }

  pending.count -= 1;
  state.purchases = state.purchases.filter((p) => p.count > 0);
  addUnits(state.territories[territory], type, 1, power);
  log(state, `${POWERS[power].display} mobilizes ${UNITS[type].display} in ${TERRITORY_INDEX[territory].display}.`);
  return { ok: true };
}

/** Repair strategic-bombing damage in the purchase phase (1 IPC per point). */
export function repairFactory(state: GameState, power: PowerId, territory: string, amount: number): PlaceResult {
  if (state.phase !== "purchase") return { ok: false, reason: "Repairs happen in the purchase phase." };
  const ts = state.territories[territory];
  if (ts.controller !== power) return { ok: false, reason: "You don't control that factory." };
  const damage = ts.factoryDamage ?? 0;
  const fix = Math.max(0, Math.min(amount, damage));
  if (fix <= 0) return { ok: false, reason: "Nothing to repair there." };
  // Improved Shipyards halves repair cost.
  const cost = hasTech(state, power, "improved_shipyards") ? Math.ceil(fix / 2) : fix;
  if (state.treasury[power] < cost) return { ok: false, reason: "Not enough IPC to repair." };
  state.treasury[power] -= cost;
  ts.factoryDamage = damage - fix;
  log(state, `${POWERS[power].display} repairs ${fix} factory damage in ${TERRITORY_INDEX[territory].display}.`);
  return { ok: true };
}

// --- Victory ---------------------------------------------------------------

/** Axis/Allies win by holding every enemy capital, or N victory cities. */
export function checkVictory(state: GameState): void {
  if (state.winner) return;

  if (state.options.victory.mode === "cities") {
    const need = state.options.victory.cities;
    const counts: Record<string, number> = { Axis: 0, Allies: 0 };
    for (const ts of Object.values(state.territories)) {
      if (TERRITORY_INDEX[ts.id]?.victoryCity && ts.controller) {
        const alliance = POWERS[ts.controller].alliance;
        if (alliance === "Axis" || alliance === "Allies") counts[alliance] += 1;
      }
    }
    if (counts.Axis >= need) {
      state.winner = "Axis";
      log(state, `AXIS VICTORY — ${counts.Axis} victory cities held.`);
      return;
    }
    if (counts.Allies >= need) {
      state.winner = "Allies";
      log(state, `ALLIED VICTORY — ${counts.Allies} victory cities held.`);
      return;
    }
    return;
  }

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
