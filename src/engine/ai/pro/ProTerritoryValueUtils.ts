/*
 * Ported from TripleA (https://github.com/triplea-game/triplea)
 * games.strategy.triplea.ai.pro.util.ProTerritoryValueUtils — © TripleA
 * contributors. Licensed under the GNU General Public License v3.0 or later.
 *
 * Faithful port of findTerritoryValues / findLandValue / findWaterValue /
 * findEnemyCapitalsAndFactoriesValue / findTerritoryAttackValue, keeping the
 * Java's magic constants (3.0 * production, *32 capital weighting, /(1+3*neutral),
 * the 1/2^distance decays, *1.1 factory preference, /100 and /10 water mixing).
 * Distances come from our BFS graph (ProMapGraph) instead of GameMap.getDistance
 * / Route. Degraded: territoryEffects, "territoriesThatCantBeHeld" /
 * "territoriesToAttack" planner lists (treated as empty), and BreadthFirstSearch
 * land-mass sizing is approximated with our land distance map.
 */
import type { GameState, PowerId } from "../../types.js";
import { TERRITORIES, TERRITORY_INDEX, isLand, isSea } from "../../data/territories.js";
import { POWERS, areAllied } from "../../data/powers.js";
import { areEnemies } from "../../rules/politics.js";
import { seaDistance, distanceMap } from "./ProMapGraph.js";

// ============================================================================
// ProTerritoryValueUtils — assigns each territory a strategic value the Pro AI
// uses to rank objectives. Land value blends (a) decayed value of nearby enemy
// capitals / factories and (b) nearby enemy production; sea value blends nearby
// enemy capitals / factories and adjacent land value. Higher = more worth
// fighting for.
// ============================================================================

const MIN_FACTORY_CHECK_DISTANCE = 9;

const production = (id: string): number => TERRITORY_INDEX[id]?.ipc ?? 0;

const hasFactory = (state: GameState, id: string): boolean =>
  (state.territories[id]?.units ?? []).some(
    (u) => u.type === "major_ic" || u.type === "minor_ic",
  );

const controllerOf = (state: GameState, id: string): PowerId | undefined =>
  state.territories[id]?.controller;

const isEnemyLand = (state: GameState, id: string, player: PowerId): boolean => {
  const c = controllerOf(state, id);
  return isLand(id) && !!c && areEnemies(state, c, player);
};

const isNeutralLand = (id: string): boolean => !!TERRITORY_INDEX[id]?.neutral;

/** ProUtils.getPlayerProduction — total IPC of land a power controls. */
function playerProduction(state: GameState, player: PowerId): number {
  let total = 0;
  for (const t of TERRITORIES) {
    if (isSea(t.id)) continue;
    if (state.territories[t.id]?.controller === player) total += t.ipc;
  }
  return total;
}

/** Live enemy capitals (still controlled by an enemy power) for `player`. */
function liveEnemyCapitals(state: GameState, player: PowerId): string[] {
  const out: string[] = [];
  for (const p of Object.values(POWERS)) {
    if (p.id === "Neutral" || !p.capital) continue;
    if (!areEnemies(state, p.id, player)) continue;
    if (state.territories[p.capital]?.controller === p.id) out.push(p.capital);
  }
  return out;
}

/** Powers `player` is (or may become) at war with. */
function potentialEnemies(player: PowerId): PowerId[] {
  return (Object.values(POWERS) as { id: PowerId }[])
    .map((p) => p.id)
    .filter((id) => id !== "Neutral" && POWERS[id].alliance !== POWERS[player].alliance);
}

/**
 * findTerritoryAttackValue — relative value of attacking `t`. 3 * production *
 * (enemyFactory ? 2 : 1), minus a neutral-defence TUV penalty. Faithful.
 */
export function findTerritoryAttackValue(
  state: GameState,
  player: PowerId,
  t: string,
  minCostPerHitPoint: number,
): number {
  const isEnemyFactory = isEnemyLand(state, t, player) && hasFactory(state, t) ? 1 : 0;
  let value = 3.0 * production(t) * (isEnemyFactory + 1);
  if (isNeutralLand(t)) {
    // Estimate the cost of clearing the neutral garrison (strength / 8 casualties).
    const garrison = (state.territories[t]?.units ?? []).reduce((s, u) => s + u.count, 0);
    const strength = 2 * garrison; // crude: ~2 strength per defending unit
    value += -(strength / 8) * minCostPerHitPoint;
  }
  return value;
}

/** Approximate land-mass size: reachable land nodes from `t` (capped search). */
function findMaxLandMassSize(state: GameState, player: PowerId): number {
  let max = 1;
  const visited = new Set<string>();
  for (const t of TERRITORIES) {
    if (isSea(t.id) || visited.has(t.id)) continue;
    const reach = distanceMap(state, t.id, "land", player, true);
    let size = 0;
    for (const id of Object.keys(reach)) {
      if (isLand(id)) {
        size += 1;
        visited.add(id);
      }
    }
    if (size > max) max = size;
  }
  return max;
}

/**
 * findEnemyCapitalsAndFactoriesValue — value of each enemy capital / factory.
 * value = sqrt(factoryProduction + sqrt(playerProduction)) * 32 / (1+3*neutral)
 *         * landMassSize / maxLandMassSize
 * Faithful, including the "drop factories if most enemy territory has one" rule.
 */
function findEnemyCapitalsAndFactoriesValue(
  state: GameState,
  player: PowerId,
  maxLandMassSize: number,
): Record<string, number> {
  const enemies = potentialEnemies(player);
  const allLand = TERRITORIES.filter((t) => isLand(t.id));
  const enemyFactories = allLand
    .filter((t) => {
      const c = controllerOf(state, t.id);
      return hasFactory(state, t.id) && !!c && enemies.includes(c);
    })
    .map((t) => t.id);
  const numEnemyTerritories = allLand.filter((t) => {
    const c = controllerOf(state, t.id);
    return !!c && enemies.includes(c);
  }).length;

  const set = new Set<string>(enemyFactories);
  if (set.size * 2 >= numEnemyTerritories) set.clear();
  for (const cap of liveEnemyCapitals(state, player)) set.add(cap);

  const map: Record<string, number> = {};
  for (const t of set) {
    const factoryProduction = hasFactory(state, t) ? production(t) : 0;
    const owner = controllerOf(state, t);
    const capitalOwner = (Object.values(POWERS) as { id: PowerId; capital: string }[]).find(
      (p) => p.capital === t,
    )?.id;
    const playerProd = capitalOwner && owner === capitalOwner ? playerProduction(state, owner) : 0;
    const isNeutral = isNeutralLand(t) ? 1 : 0;
    const reach = distanceMap(state, t, "land", player, true);
    const landMassSize =
      1 + Object.entries(reach).filter(([id, d]) => isLand(id) && d > 0 && d <= 6).length;
    const value =
      (Math.sqrt(factoryProduction + Math.sqrt(playerProd)) * 32) /
      (1 + 3.0 * isNeutral) *
      (landMassSize / maxLandMassSize);
    map[t] = value;
  }
  return map;
}

/** Capitals / factories reachable from `t` within the factory-check window. */
function findNearbyEnemyCapitalsAndFactories(
  dist: Record<string, number>,
  capitalsAndFactories: Set<string>,
): { id: string; distance: number }[] {
  const found: { id: string; distance: number }[] = [];
  for (const id of capitalsAndFactories) {
    const d = dist[id];
    if (d !== undefined && d > 0) found.push({ id, distance: d });
  }
  // Mirror BreadthFirstSearch behaviour: if anything within MIN_FACTORY_CHECK
  // distance, prefer those; else keep whatever was found at greater distance.
  const near = found.filter((f) => f.distance <= MIN_FACTORY_CHECK_DISTANCE);
  return near.length > 0 ? near : found;
}

function findLandValue(
  state: GameState,
  t: string,
  player: PowerId,
  maxLandMassSize: number,
  capitalsAndFactories: Record<string, number>,
  minCostPerHitPoint: number,
): number {
  const dist = distanceMap(state, t, "land", player, true);

  // (a) decayed value of nearby enemy capitals / factories.
  const nearby = findNearbyEnemyCapitalsAndFactories(
    dist,
    new Set(Object.keys(capitalsAndFactories)),
  );
  const values: number[] = [];
  for (const { id, distance } of nearby) {
    values.push(capitalsAndFactories[id] / Math.pow(2, distance));
  }
  values.sort((a, b) => b - a);
  let capitalOrFactoryValue = 0;
  for (let i = 0; i < values.length; i++) {
    capitalOrFactoryValue += values[i] / Math.pow(2, i);
  }

  // (b) nearby enemy production within 2 hops.
  let nearbyEnemyValue = 0;
  for (const [id, d] of Object.entries(dist)) {
    if (d <= 0 || d > 2 || !isLand(id)) continue;
    const c = controllerOf(state, id);
    const enemy = !!c && areEnemies(state, c, player);
    if (!enemy) continue;
    let value = production(id);
    if (isNeutralLand(id)) {
      value = findTerritoryAttackValue(state, player, id, minCostPerHitPoint) / 3;
    } else if (alliedWithNoEnemyNeighbours(state, id, player)) {
      value *= 0.1;
    }
    if (value > 0) nearbyEnemyValue += value / Math.pow(2, d);
  }

  const landMassSize =
    1 + Object.entries(dist).filter(([id, d]) => isLand(id) && d > 0 && d <= 6).length;
  let value = (nearbyEnemyValue * landMassSize) / maxLandMassSize + capitalOrFactoryValue;
  if (hasFactory(state, t)) value *= 1.1;
  return value;
}

function alliedWithNoEnemyNeighbours(state: GameState, id: string, player: PowerId): boolean {
  const c = controllerOf(state, id);
  if (!c || (c !== player && !areAllied(c, player))) return false;
  const dist = distanceMap(state, id, "land", player, true);
  for (const [n, d] of Object.entries(dist)) {
    if (d !== 1) continue;
    if (isEnemyLand(state, n, player)) return false;
  }
  return true;
}

function findWaterValue(
  state: GameState,
  t: string,
  player: PowerId,
  maxLandMassSize: number,
  capitalsAndFactories: Record<string, number>,
  minCostPerHitPoint: number,
  territoryValueMap: Record<string, number>,
): number {
  const seaDist = seaDistance(state, t, player);
  const hasSeaNeighbour = Object.entries(seaDist).some(([id, d]) => isSea(id) && d === 1);
  if (!hasSeaNeighbour) return 0;

  // (a) decayed enemy capital / factory value, reached over water.
  const nearby = findNearbyEnemyCapitalsAndFactories(
    seaDist,
    new Set(Object.keys(capitalsAndFactories)),
  );
  const values: number[] = [];
  for (const { id, distance } of nearby) {
    values.push(capitalsAndFactories[id] / Math.pow(2, distance));
  }
  values.sort((a, b) => b - a);
  let capitalOrFactoryValue = 0;
  for (let i = 0; i < values.length; i++) {
    capitalOrFactoryValue += values[i] / Math.pow(2, i);
  }

  // (b) nearby land value within 3 sea hops (sea zones touch land via adjacency).
  let nearbyLandValue = 0;
  for (const [id, d] of Object.entries(seaDist)) {
    if (d <= 0 || d > 3 || !isLand(id)) continue;
    if (isEnemyLand(state, id, player)) {
      let value = production(id);
      if (isNeutralLand(id)) {
        value = findTerritoryAttackValue(state, player, id, minCostPerHitPoint);
      }
      nearbyLandValue += value;
    }
    if (territoryValueMap[id] === undefined) {
      territoryValueMap[id] = findLandValue(
        state,
        id,
        player,
        maxLandMassSize,
        capitalsAndFactories,
        minCostPerHitPoint,
      );
    }
    nearbyLandValue += territoryValueMap[id];
  }

  return capitalOrFactoryValue / 100 + nearbyLandValue / 10;
}

/**
 * findTerritoryValues — value of each territory in `territoriesToCheck` (land
 * first, then water, since water value references computed land values).
 * `minCostPerHitPoint` is the cheapest IPC-per-hitpoint land unit (≈ infantry).
 */
export function findTerritoryValues(
  state: GameState,
  player: PowerId,
  territoriesToCheck: string[],
  minCostPerHitPoint = 3,
): Record<string, number> {
  const maxLandMassSize = findMaxLandMassSize(state, player);
  const capitalsAndFactories = findEnemyCapitalsAndFactoriesValue(state, player, maxLandMassSize);
  const territoryValueMap: Record<string, number> = {};

  for (const t of territoriesToCheck) {
    if (isLand(t)) {
      territoryValueMap[t] = findLandValue(
        state,
        t,
        player,
        maxLandMassSize,
        capitalsAndFactories,
        minCostPerHitPoint,
      );
    }
  }
  for (const t of territoriesToCheck) {
    if (isSea(t)) {
      territoryValueMap[t] = findWaterValue(
        state,
        t,
        player,
        maxLandMassSize,
        capitalsAndFactories,
        minCostPerHitPoint,
        territoryValueMap,
      );
    }
  }
  return territoryValueMap;
}
