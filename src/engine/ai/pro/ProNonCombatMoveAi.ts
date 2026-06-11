/*
 * Ported from TripleA (https://github.com/triplea-game/triplea)
 * games.strategy.triplea.ai.pro.ProNonCombatMoveAi — © TripleA contributors.
 * Licensed under the GNU General Public License v3.0 or later.
 *
 * Pragmatic port of the non-combat planner. Java's doNonCombatMove runs a large
 * value-iteration over defend options; we keep the load-bearing behaviours:
 *   1. defend threatened friendly territories (capital first, then factories)
 *      by pulling reinforcements via populateDefenseOptions + the enemy threat
 *      map (populateEnemyAttackOptions);
 *   2. land aircraft safely — air units must end on friendly land (or a carrier
 *      sea zone), or the engine strands them, so we always route air home;
 *   3. push idle land units toward the front (distanceToNearestEnemyLand
 *      decreasing) so they don't sit uselessly in the rear.
 * Emitted via calculateMoveActions(..., false) which validates every move.
 */
import type { GameState, PowerId, UnitTypeId } from "../../types.js";
import type { Action } from "../../rules/actions.js";
import { UNITS } from "../../data/units.js";
import { POWERS, areAllied } from "../../data/powers.js";
import { areEnemies } from "../../rules/politics.js";
import { isSea, isLand, TERRITORIES } from "../../data/territories.js";
import { buildProData } from "./ProData.js";
import { populateDefenseOptions, populateEnemyAttackOptions } from "./ProTerritoryManager.js";
import { distanceToNearestEnemyLand, graphDistance } from "./ProMapGraph.js";
import { estimateStrength } from "./ProBattleUtils.js";
import { calculateMoveActions } from "./ProMoveUtils.js";
import {
  type ProTerritory,
  createProTerritory,
  addUnit,
} from "./ProTerritory.js";

const isAir = (type: UnitTypeId): boolean => UNITS[type].domain === "air";
const isLandUnit = (type: UnitTypeId): boolean => UNITS[type].domain === "land";

function hasFactory(state: GameState, id: string): boolean {
  return (state.territories[id]?.units ?? []).some(
    (u) => u.type === "major_ic" || u.type === "minor_ic",
  );
}

/** Strategic priority of holding a friendly territory: capital > factory > IPC. */
function defendPriority(state: GameState, power: PowerId, id: string): number {
  let p = 0;
  if (POWERS[power].capital === id) p += 1000;
  if (hasFactory(state, id)) p += 100;
  p += (state.territories[id]?.units ?? []).length; // tiebreak toward occupied land
  return p;
}

/** Friendly land territories `power` controls (defence candidates). */
function myLandTerritories(state: GameState, power: PowerId): string[] {
  const out: string[] = [];
  for (const t of TERRITORIES) {
    if (!isLand(t.id)) continue;
    const c = state.territories[t.id]?.controller;
    if (c === power || (c && areAllied(c, power))) out.push(t.id);
  }
  return out;
}

/**
 * Plan the non-combat phase: defend threatened territories, then land aircraft,
 * then push idle land units forward.
 */
export function planNonCombatMove(state: GameState): Action[] {
  const power = state.activePower;
  const pd = buildProData(state, power);

  // Enemy threat map — which of my territories an enemy could hit next turn,
  // and how hard. We defend the threatened, valuable ones.
  const enemyMap = populateEnemyAttackOptions(state, power);

  const friendly = myLandTerritories(state, power);
  // Territories worth reinforcing: under threat and strategically valuable, with
  // capital/factory weighting. Sorted so the most important pulls units first.
  const threatened = friendly
    .filter((id) => {
      const threat = enemyMap[id];
      if (!threat) return id === pd.myCapital || hasFactory(state, id);
      return threat.maxUnits.length > 0;
    })
    .sort((a, b) => defendPriority(state, power, b) - defendPriority(state, power, a));

  const { moveMap } = populateDefenseOptions(state, power, threatened);

  // Commit reinforcements: for each threatened territory (priority order) move in
  // the strongest available reinforcements until it out-defends the incoming
  // enemy strength (or we run out of movers). A unit may be claimed only once;
  // calculateMoveActions re-validates so over-commitment self-drops.
  const plans: ProTerritory[] = [];
  const used = new Map<string, number>(); // `${from}:${type}` -> committed count

  for (const id of threatened) {
    const pt = moveMap[id];
    if (!pt || pt.maxUnits.length === 0) continue;

    const incoming = enemyMap[id];
    const enemyStr = incoming
      ? estimateStrength(
          state,
          incoming.maxUnits.map((u) => ({ type: u.type, owner: enemyOwnerOf(state, u.from, u.type), count: u.count })),
          true,
          incoming.maxUnits[0] ? enemyOwnerOf(state, incoming.maxUnits[0].from, incoming.maxUnits[0].type) : "Neutral",
        )
      : 0;

    // Current defenders here.
    let myStr = estimateStrength(
      state,
      (state.territories[id]?.units ?? [])
        .filter((u) => (u.owner === power || areAllied(u.owner, power)) && u.count > 0)
        .map((u) => ({ type: u.type, owner: u.owner, count: u.count })),
      false,
      power,
    );

    const dest = createProTerritory(id);
    // Strongest reinforcements first (defence value ~ defense stat + hits).
    const movers = [...pt.maxUnits].sort(
      (a, b) =>
        UNITS[b.type].defense + UNITS[b.type].hits - (UNITS[a.type].defense + UNITS[a.type].hits),
    );
    for (const opt of movers) {
      if (myStr > enemyStr * 1.2 && enemyStr > 0) break;
      const key = `${opt.from}:${opt.type}`;
      const already = used.get(key) ?? 0;
      const avail = opt.count - already;
      if (avail <= 0) continue;
      addUnit(dest, { from: opt.from, type: opt.type, count: avail });
      used.set(key, already + avail);
      myStr += estimateStrength(state, [{ type: opt.type, owner: power, count: avail }], false, power);
    }
    if (dest.units.length > 0) plans.push(dest);
  }

  // Land aircraft: any of my air units not already on safe friendly land/carrier
  // must be routed to the nearest safe friendly land. The engine strands unsafe
  // air at end of phase, so this is mandatory, not optional.
  landAircraft(state, power, plans, used);

  // Push idle land units toward the front (decreasing distance-to-enemy), so the
  // rear doesn't stagnate. Only units not already committed above.
  advanceIdleLand(state, power, pd.myCapital, plans, used);

  return calculateMoveActions(state, power, plans, false);
}

function enemyOwnerOf(state: GameState, from: string, type: UnitTypeId): PowerId {
  return state.territories[from]?.units.find((s) => s.type === type)?.owner ?? "Neutral";
}

/** True if `power`'s air is safe ending in territory `id` this phase. */
function airSafe(state: GameState, power: PowerId, id: string): boolean {
  if (isSea(id)) {
    return (state.territories[id]?.units ?? []).some(
      (u) => u.type === "aircraft_carrier" && (u.owner === power || areAllied(u.owner, power)),
    );
  }
  const c = state.territories[id]?.controller;
  if (!c || (c !== power && !areAllied(c, power))) return false;
  // Not safe if an enemy could overrun it — but at minimum it must be friendly.
  return true;
}

function landAircraft(
  state: GameState,
  power: PowerId,
  plans: ProTerritory[],
  used: Map<string, number>,
): void {
  for (const t of TERRITORIES) {
    const here = t.id;
    const air = (state.territories[here]?.units ?? []).filter(
      (u) => u.owner === power && isAir(u.type) && u.count > 0,
    );
    if (air.length === 0) continue;
    if (airSafe(state, power, here)) continue; // already safe — leave it

    for (const stack of air) {
      const key = `${here}:${stack.type}`;
      const already = used.get(key) ?? 0;
      const avail = stack.count - already;
      if (avail <= 0) continue;
      // Find the nearest safe friendly land within range (air overflies, so use
      // graph distance ≤ movement allowance, +1 for an air base bonus we can't
      // see here — calculateMoveActions re-validates the real range).
      const range = UNITS[stack.type].movement + 1;
      let best: string | undefined;
      let bestDist = Infinity;
      for (const cand of TERRITORIES) {
        if (!isLand(cand.id)) continue;
        if (!airSafe(state, power, cand.id)) continue;
        const d = graphDistance(state, here, cand.id, "air", power);
        if (d > range || d <= 0) continue;
        if (d < bestDist) {
          bestDist = d;
          best = cand.id;
        }
      }
      if (!best) continue;
      let dest = plans.find((p) => p.territoryId === best);
      if (!dest) {
        dest = createProTerritory(best);
        plans.push(dest);
      }
      addUnit(dest, { from: here, type: stack.type, count: avail });
      used.set(key, already + avail);
    }
  }
}

function advanceIdleLand(
  state: GameState,
  power: PowerId,
  capital: string | undefined,
  plans: ProTerritory[],
  used: Map<string, number>,
): void {
  for (const t of TERRITORIES) {
    const here = t.id;
    if (!isLand(here)) continue;
    const c = state.territories[here]?.controller;
    if (c !== power && !(c && areAllied(c, power))) continue;
    // Don't drain the capital or factory garrisons we just reinforced.
    if (here === capital || hasFactory(state, here)) continue;
    // Skip territories adjacent to enemies — those units should stay to defend /
    // were combat-committed already.
    const myDist = distanceToNearestEnemyLand(state, here, power);
    if (!Number.isFinite(myDist) || myDist <= 1) continue;

    const movers = (state.territories[here]?.units ?? []).filter(
      (u) => u.owner === power && isLandUnit(u.type) && !UNITS[u.type].immobileInCombatMove && u.count > 0,
    );
    if (movers.length === 0) continue;

    // Find an adjacent-or-near friendly land that is strictly closer to the enemy.
    let best: string | undefined;
    let bestDist = myDist;
    for (const cand of TERRITORIES) {
      if (!isLand(cand.id) || cand.id === here) continue;
      const cc = state.territories[cand.id]?.controller;
      if (cc !== power && !(cc && areAllied(cc, power))) continue;
      const hop = graphDistance(state, here, cand.id, "land", power);
      if (hop <= 0 || hop > 2) continue; // reachable in ~2 hops at most this phase
      const d = distanceToNearestEnemyLand(state, cand.id, power);
      if (Number.isFinite(d) && d < bestDist) {
        bestDist = d;
        best = cand.id;
      }
    }
    if (!best) continue;

    let dest = plans.find((p) => p.territoryId === best);
    if (!dest) {
      dest = createProTerritory(best);
      plans.push(dest);
    }
    for (const stack of movers) {
      const key = `${here}:${stack.type}`;
      const already = used.get(key) ?? 0;
      const avail = stack.count - already;
      if (avail <= 0) continue;
      addUnit(dest, { from: here, type: stack.type, count: avail });
      used.set(key, already + avail);
    }
  }
}
