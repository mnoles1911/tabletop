/*
 * Ported from TripleA (https://github.com/triplea-game/triplea)
 * games.strategy.triplea.ai.pro.util.ProPurchaseUtils and
 * games.strategy.triplea.ai.pro.data.ProPurchaseOption — © TripleA contributors.
 * Licensed under the GNU General Public License v3.0 or later.
 *
 * ProPurchaseOption ports the per-unit efficiency record built in the Java
 * constructor (costPerHitPoint, hitPointEfficiency, attackEfficiency,
 * defenseEfficiency, transportEfficiency) with the exact arithmetic — including
 * the diceSides scaling (6/6 = 1 here) and the (1 + hitPoints) attack/defense
 * weighting. findPurchaseOptions honours China's infantry-only rule;
 * findPlaceTerritories enumerates legal placement via the engine's
 * placementOptions / remainingCapacity / factoryCapacity.
 */
import type { GameState, PowerId, UnitTypeId } from "../../types.js";
import { UNITS, PURCHASABLE, hasFlag } from "../../data/units.js";
import { isSea } from "../../data/territories.js";
import { placementOptions, remainingCapacity, factoryCapacity } from "../../rules/phases.js";

// ============================================================================
// ProPurchaseOption — efficiency metrics over a buyable unit type. quantity is 1
// (each production rule yields one unit in our model). diceSides = 6, so the
// Java `* 6 / diceSides` factor is identity; we keep it explicit for fidelity.
// ============================================================================

const DICE_SIDES = 6;

export interface ProPurchaseOption {
  type: UnitTypeId;
  cost: number;
  quantity: number;
  /** Fighting hit points (0 for infrastructure). */
  hitPoints: number;
  attack: number;
  defense: number;
  movement: number;
  /** cost / hitPoints, or +Infinity for infrastructure (Java). */
  costPerHitPoint: number;
  hitPointEfficiency: number;
  attackEfficiency: number;
  defenseEfficiency: number;
  /** Transport capacity / cost (0 for non-transports). */
  transportEfficiency: number;
  isLand: boolean;
  isSea: boolean;
  isAir: boolean;
  isInfrastructure: boolean;
}

const isInfra = (type: UnitTypeId): boolean =>
  UNITS[type].domain === "structure" || type === "aa_gun";

/** Build the ProPurchaseOption record for one unit type (Java constructor). */
export function buildPurchaseOption(type: UnitTypeId): ProPurchaseOption {
  const u = UNITS[type];
  const quantity = 1;
  const cost = u.cost * quantity;
  const infra = isInfra(type);
  const hitPoints = infra ? 0 : u.hits * quantity;
  const attack = u.attack * quantity;
  const defense = u.defense * quantity;
  const movement = u.movement;

  const a = (attack * 6) / DICE_SIDES;
  const d = (defense * 6) / DICE_SIDES;

  const costPerHitPoint = hitPoints === 0 ? Number.POSITIVE_INFINITY : cost / hitPoints;
  const hitPointEfficiency = (hitPoints + 0.2 * a + 0.2 * d) / cost;
  const attackEfficiency = ((1 + hitPoints) * (hitPoints + a + 0.5 * d)) / cost;
  const defenseEfficiency = ((1 + hitPoints) * (hitPoints + 0.5 * a + d)) / cost;
  const transportEfficiency = hasFlag(type, "transports_land")
    ? (u.capacity ?? 0) / cost
    : 0;

  return {
    type,
    cost,
    quantity,
    hitPoints,
    attack,
    defense,
    movement,
    costPerHitPoint,
    hitPointEfficiency,
    attackEfficiency,
    defenseEfficiency,
    transportEfficiency,
    isLand: u.domain === "land" && !infra,
    isSea: u.domain === "sea",
    isAir: u.domain === "air",
    isInfrastructure: infra,
  };
}

/**
 * findPurchaseOptions — every unit `power` may buy, as ProPurchaseOption records.
 * China's special restriction (it may only ever build infantry) is honoured,
 * matching actions.ts's buy validation.
 */
export function findPurchaseOptions(power: PowerId): ProPurchaseOption[] {
  const types = power === "China" ? (["infantry"] as UnitTypeId[]) : PURCHASABLE;
  return types.map(buildPurchaseOption);
}

/** Land-combat purchase options (Java landPurchaseOptions) for `power`. */
export function findLandPurchaseOptions(power: PowerId): ProPurchaseOption[] {
  return findPurchaseOptions(power).filter((o) => o.isLand);
}

/** Sea purchase options (Java seaPurchaseOptions). */
export function findSeaPurchaseOptions(power: PowerId): ProPurchaseOption[] {
  return findPurchaseOptions(power).filter((o) => o.isSea);
}

/** Air purchase options (Java airPurchaseOptions). */
export function findAirPurchaseOptions(power: PowerId): ProPurchaseOption[] {
  return findPurchaseOptions(power).filter((o) => o.isAir);
}

export interface ProPlaceTerritory {
  territoryId: string;
  /** Units still placeable here this turn (0 for sea zones — limited by feeder factory). */
  remainingCapacity: number;
  isSea: boolean;
}

/**
 * findPlaceTerritories — where `power` can mobilize this turn. A land factory
 * territory with remaining capacity, plus the adjacent sea zones its naval units
 * could place into. Capacity for sea zones is reported via the feeding factory.
 */
export function findPlaceTerritories(state: GameState, power: PowerId): ProPlaceTerritory[] {
  const out: ProPlaceTerritory[] = [];
  const seen = new Set<string>();

  // Land factory placement targets (infantry stands in for any land unit).
  for (const tid of placementOptions(state, power, "infantry")) {
    if (seen.has(tid)) continue;
    seen.add(tid);
    out.push({
      territoryId: tid,
      remainingCapacity: remainingCapacity(state, power, tid),
      isSea: false,
    });
  }
  // Sea placement targets (a transport stands in for any sea unit).
  for (const sid of placementOptions(state, power, "transport")) {
    if (seen.has(sid) || !isSea(sid)) continue;
    seen.add(sid);
    out.push({ territoryId: sid, remainingCapacity: 0, isSea: true });
  }
  return out;
}

/** Re-export of the engine capacity helper for planner symmetry. */
export { factoryCapacity, remainingCapacity };
