/*
 * Ported from TripleA (https://github.com/triplea-game/triplea)
 * In the spirit of games.strategy.engine.data.GameMap / Route / BreadthFirstSearch
 * and games.strategy.triplea.ai.pro.util.ProUtils route helpers — © TripleA
 * contributors. Licensed under the GNU General Public License v3.0 or later.
 *
 * Original module (no single Java class corresponds one-to-one): BFS distance
 * maps over our adjacency graph, the foundation TripleA reaches for via
 * GameMap.getDistance / getNeighbors when the Pro AI reasons about reachability.
 */
import type { GameState, PowerId, UnitTypeId } from "../../types.js";
import { UNITS } from "../../data/units.js";
import { areAllied } from "../../data/powers.js";
import { areEnemies } from "../../rules/politics.js";
import { isSea, isLand, canalGates } from "../../data/territories.js";
import { neighbours } from "../../rules/setup.js";

// ============================================================================
// ProMapGraph — breadth-first distance maps over the territory adjacency graph,
// the substrate the Pro AI uses for "how far is the enemy" reasoning. TripleA
// builds these on the fly via GameMap.getDistance / getNeighbors; we precompute
// per-call BFS layers respecting unit domain (land / sea / air).
//
// Distances are hop counts (edges traversed), matching TripleA's Route step
// counts, NOT movement-point budgets — movement legality is delegated to
// rules/movement.checkMove by the planners. These maps answer "is this even
// reachable, and roughly how near" for value decay and target ranking.
// ============================================================================

export type DistanceMap = Record<string, number>;

/** The three traversal domains, mirroring TripleA's land/sea/air route matches. */
export type GraphDomain = "land" | "sea" | "air";

const domainOf = (type: UnitTypeId): GraphDomain => {
  const d = UNITS[type].domain;
  return d === "air" ? "air" : d === "sea" ? "sea" : "land";
};

/**
 * Can `node` be traversed as an intermediate step by `domain` owned by `owner`?
 * Mirrors ProMatches.territoryCanMove{Land,Sea,Air}Units, slimmed to our model:
 *   - air overflies anything,
 *   - land stays on land, sea stays on sea,
 *   - sea respects canal gates (must be friendly-controlled),
 *   - enemy-occupied nodes block land/sea passage (zone of control).
 * `passThroughEnemies` lets callers (e.g. distanceToNearestEnemyLand) count the
 * target node itself even though it holds enemies.
 */
function canTraverse(
  state: GameState,
  from: string,
  node: string,
  domain: GraphDomain,
  owner: PowerId,
  passThroughEnemies: boolean,
): boolean {
  if (domain === "air") return true;
  if (domain === "land" && !isLand(node)) return false;
  if (domain === "sea" && !isSea(node)) return false;
  if (domain === "sea") {
    const gates = canalGates(from, node);
    if (gates) {
      const blocked = gates.some((g) => {
        const gc = state.territories[g]?.controller;
        return !gc || (gc !== owner && !areAllied(gc, owner));
      });
      if (blocked) return false;
    }
  }
  if (passThroughEnemies) return true;
  const ts = state.territories[node];
  return !ts?.units.some((u) => areEnemies(state, u.owner, owner) && u.count > 0);
}

/**
 * BFS hop-count distance from `from` to every node reachable by `domain` for
 * `owner`. Like TripleA's GameMap.getNeighbors layered outward. When
 * `passThroughEnemies` is false, enemy-held nodes terminate a branch (they are
 * still recorded with their distance — you can reach them, just not past them).
 */
export function distanceMap(
  state: GameState,
  from: string,
  domain: GraphDomain,
  owner: PowerId,
  passThroughEnemies = false,
): DistanceMap {
  const dist: DistanceMap = { [from]: 0 };
  let frontier: string[] = [from];
  let d = 0;
  while (frontier.length) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const n of neighbours(node)) {
        if (n in dist) continue;
        if (!canTraverse(state, node, n, domain, owner, passThroughEnemies)) continue;
        dist[n] = d + 1;
        // Only keep expanding through nodes we may pass through. An enemy-held
        // node is recorded but its branch stops here (unless overflying).
        const ts = state.territories[n];
        const blockedByEnemy =
          domain !== "air" &&
          !passThroughEnemies &&
          !!ts?.units.some((u) => areEnemies(state, u.owner, owner) && u.count > 0);
        if (!blockedByEnemy) next.push(n);
      }
    }
    frontier = next;
    d += 1;
  }
  return dist;
}

/** Land-graph hop distances from `from` for `owner` (enemy lands terminate branches). */
export const landDistance = (state: GameState, from: string, owner: PowerId): DistanceMap =>
  distanceMap(state, from, "land", owner);

/** Sea-graph hop distances from `from` for `owner` (canal-aware). */
export const seaDistance = (state: GameState, from: string, owner: PowerId): DistanceMap =>
  distanceMap(state, from, "sea", owner);

/** Air hop distances from `from` (overflies everything; owner only used for parity). */
export const airDistance = (state: GameState, from: string, owner: PowerId): DistanceMap =>
  distanceMap(state, from, "air", owner);

/**
 * Hop distance to the nearest enemy-owned land territory over the land graph,
 * or Infinity if none is reachable. Mirrors the intent of
 * ProUtils.getClosestEnemyLandTerritoryDistance — enemy lands are reachable
 * endpoints (passThroughEnemies so the search isn't stopped by closer enemies).
 */
export function distanceToNearestEnemyLand(
  state: GameState,
  from: string,
  power: PowerId,
): number {
  const dist = distanceMap(state, from, "land", power, true);
  let best = Infinity;
  for (const [id, d] of Object.entries(dist)) {
    if (d === 0) continue;
    if (!isLand(id)) continue;
    const c = state.territories[id]?.controller;
    if (c && areEnemies(state, c, power)) best = Math.min(best, d);
  }
  return best;
}

/** True if `to` is reachable from `from` for a unit of `type` owned by `owner`. */
export function isReachable(
  state: GameState,
  from: string,
  to: string,
  type: UnitTypeId,
  owner: PowerId,
): boolean {
  if (from === to) return true;
  const dist = distanceMap(state, from, domainOf(type), owner, true);
  return to in dist;
}

/** Hop distance between two territories over `domain`, or Infinity. */
export function graphDistance(
  state: GameState,
  from: string,
  to: string,
  domain: GraphDomain,
  owner: PowerId,
): number {
  const dist = distanceMap(state, from, domain, owner, true);
  return to in dist ? dist[to] : Infinity;
}
