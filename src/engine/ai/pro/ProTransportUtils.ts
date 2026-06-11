/*
 * Ported from TripleA (https://github.com/triplea-game/triplea)
 * games.strategy.triplea.ai.pro.util.ProTransportUtils — © TripleA contributors.
 * Licensed under the GNU General Public License v3.0 or later.
 *
 * Slim port: the capacity arithmetic (getTransportCapacity / free capacity over
 * UNITS[t].capacity and state.transportUse) and the value-dense load selection
 * (selectUnitsToTransportFromList / findBestUnitsToLandTransport — units sorted
 * by transport cost then decreasing attack value, loaded greedily within
 * capacity). Dropped: getUnitsToTransportThatCantMoveToHigherValue (a planner
 * concern about land units that could self-move to higher value), mech-infantry
 * land-transport tech, and the live-Unit replacement-optimisation pass.
 */
import type { GameState, PowerId, UnitTypeId } from "../../types.js";
import { UNITS } from "../../data/units.js";

// ============================================================================
// ProTransportUtils — transport capacity math + best-units-to-load selection.
// Our transports each carry UNITS.transport.capacity (2) "slots"; every land
// unit costs 1 slot (the engine's transport.ts charges 1 per unit), so the
// Java getTransportCost() is uniformly 1 here.
// ============================================================================

const TRANSPORT_COST = 1;

/** Per-transport capacity (Java UnitAttachment.getTransportCapacity). */
export function transportCapacity(): number {
  return UNITS.transport.capacity ?? 2;
}

/**
 * Free transport capacity in a sea zone for `owner` this turn = transports ×
 * capacity − already-used slots. Mirrors transport.ts freeCapacity exactly so
 * the planner agrees with the engine validator.
 */
export function freeTransportCapacity(state: GameState, owner: PowerId, sea: string): number {
  const transports = (state.territories[sea]?.units ?? [])
    .filter((u) => u.owner === owner && u.type === "transport")
    .reduce((n, u) => n + u.count, 0);
  const used = state.transportUse[sea] ?? 0;
  return transports * transportCapacity() - used;
}

/** A candidate land unit available at a coastal territory, with its IPC value. */
export interface LoadableUnit {
  type: UnitTypeId;
  /** IPC cost — the value-density key (Java sorts by attack; we use TUV). */
  value: number;
}

/**
 * findBestUnitsToLoad — given the loadable units available at the load territory
 * and the free capacity (in slots), pick the value-dense set that fits. Java
 * sorts by transport cost then decreasing attack power; with uniform cost 1 we
 * sort by decreasing IPC value and fill greedily. Returns a {type,count} list.
 */
export function findBestUnitsToLoad(
  available: LoadableUnit[],
  freeCapacity: number,
): { type: UnitTypeId; count: number }[] {
  if (freeCapacity <= 0) return [];
  // Expand to one entry per physical unit so we can sort and pick individuals.
  const sorted = [...available].sort((a, b) => b.value - a.value);
  const picked: Record<string, number> = {};
  let used = 0;
  for (const u of sorted) {
    if (TRANSPORT_COST > freeCapacity - used) continue;
    picked[u.type] = (picked[u.type] ?? 0) + 1;
    used += TRANSPORT_COST;
    if (used >= freeCapacity) break;
  }
  return Object.entries(picked).map(([type, count]) => ({ type: type as UnitTypeId, count }));
}

/**
 * Expand a territory's owned land stacks into a flat list of LoadableUnits
 * (one per physical unit), value-keyed by IPC cost, for findBestUnitsToLoad.
 */
export function loadableLandUnits(
  state: GameState,
  owner: PowerId,
  landTerritory: string,
): LoadableUnit[] {
  const out: LoadableUnit[] = [];
  for (const s of state.territories[landTerritory]?.units ?? []) {
    if (s.owner !== owner) continue;
    if (UNITS[s.type].domain !== "land") continue;
    if (UNITS[s.type].immobileInCombatMove) continue; // AA / structures don't embark
    for (let i = 0; i < s.count; i++) out.push({ type: s.type, value: UNITS[s.type].cost });
  }
  return out;
}
