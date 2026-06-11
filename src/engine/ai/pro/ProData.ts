/*
 * Ported from TripleA (https://github.com/triplea-game/triplea)
 * games.strategy.triplea.ai.pro.ProData — © TripleA contributors.
 * Licensed under the GNU General Public License v3.0 or later.
 *
 * Slim port: a per-invocation snapshot the later planners (ProCombatMoveAi /
 * ProPurchaseAi) read. We keep the fields those consult — myCapital,
 * enemyCapitals, allTerritories, myUnitTerritories, unitValue map, win-percentage
 * thresholds, minCostPerHitPoint, isNeutralPlayer — and drop the ones tied to
 * machinery we don't have (ProPurchaseOptionMap, unitTerritoryMap of Unit
 * identities, unitsToBeConsumed, the AbstractProAi back-reference). Built fresh
 * each call by buildProData(state, power); never mutates the game state.
 */
import type { GameState, PowerId, UnitTypeId } from "../../types.js";
import { UNITS } from "../../data/units.js";
import { POWERS, areAllied } from "../../data/powers.js";
import { areEnemies } from "../../rules/politics.js";
import { TERRITORIES, isSea } from "../../data/territories.js";

// ============================================================================
// ProData — the read-only situational snapshot the Pro planners share. In Java
// this is a mutable singleton initialised per turn; here it's a plain object
// returned by buildProData so it stays dependency- and side-effect-free.
// ============================================================================

export interface ProData {
  /** Whether this is a hypothetical (simulation) evaluation. */
  isSimulation: boolean;
  /** Win% target the AI demands before committing an attack (LL vs dice). */
  winPercentage: number;
  /** Minimum acceptable win% (riskier attacks allowed down to this). */
  minWinPercentage: number;
  /** Our capital territory id, if we still hold one. */
  myCapital?: string;
  /** Live enemy capital territory ids. */
  enemyCapitals: string[];
  /** Every territory id on the board. */
  allTerritories: string[];
  /** Territory ids where we currently have at least one unit. */
  myUnitTerritories: string[];
  /** IPC cost of each unit type (TripleA's unitValueMap / TUV). */
  unitValue: Record<UnitTypeId, number>;
  /** Cheapest IPC per hit point among buyable land units (≈ infantry = 3). */
  minCostPerHitPoint: number;
  /** Is `power` the synthetic neutral garrison power? */
  isNeutralPlayer: (power: PowerId) => boolean;
  /** The power this snapshot is for. */
  player: PowerId;
}

const LAND_UNITS: UnitTypeId[] = [
  "infantry",
  "mech_infantry",
  "artillery",
  "tank",
];

/** Cheapest IPC-per-hit-point among land combat units (ProData.getMinCostPerHitPoint). */
function minCostPerHitPoint(): number {
  let min = Number.MAX_VALUE;
  for (const t of LAND_UNITS) {
    const cost = UNITS[t].cost / Math.max(1, UNITS[t].hits);
    if (cost < min) min = cost;
  }
  return min;
}

/** Live enemy capitals still held by their owners (ProUtils.getLiveEnemyCapitals). */
function liveEnemyCapitals(state: GameState, player: PowerId): string[] {
  const out: string[] = [];
  for (const p of Object.values(POWERS)) {
    if (p.id === "Neutral" || !p.capital) continue;
    if (!areEnemies(state, p.id, player)) continue;
    if (state.territories[p.capital]?.controller === p.id) out.push(p.capital);
  }
  return out;
}

/**
 * buildProData — assemble the per-invocation snapshot for `power`. Low-luck
 * tightens the demanded win% (95/75) vs ordinary dice (90/65) as in the Java.
 */
export function buildProData(state: GameState, power: PowerId): ProData {
  const lowLuck = state.options.lowLuck;
  const winPercentage = lowLuck ? 95 : 90;
  const minWinPercentage = lowLuck ? 75 : 65;

  const myCapitalId = POWERS[power].capital || undefined;
  const myCapital =
    myCapitalId && state.territories[myCapitalId]?.controller === power ? myCapitalId : undefined;

  const myUnitTerritories: string[] = [];
  for (const t of TERRITORIES) {
    if ((state.territories[t.id]?.units ?? []).some((u) => u.owner === power && u.count > 0)) {
      myUnitTerritories.push(t.id);
    }
  }

  const unitValue = Object.fromEntries(
    (Object.keys(UNITS) as UnitTypeId[]).map((t) => [t, UNITS[t].cost]),
  ) as Record<UnitTypeId, number>;

  return {
    isSimulation: false,
    winPercentage,
    minWinPercentage,
    myCapital,
    enemyCapitals: liveEnemyCapitals(state, power),
    allTerritories: TERRITORIES.map((t) => t.id),
    myUnitTerritories,
    unitValue,
    minCostPerHitPoint: minCostPerHitPoint(),
    isNeutralPlayer: (p: PowerId) => p === "Neutral",
    player: power,
  };
}

/** Convenience: is `t` a sea zone (used widely by planners). */
export const isWater = (t: string): boolean => isSea(t);

/** Convenience: are two powers allied (ProData often needs this). */
export const isAllied = (a: PowerId, b: PowerId): boolean => areAllied(a, b);
