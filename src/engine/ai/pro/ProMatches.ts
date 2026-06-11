/*
 * Ported from TripleA (https://github.com/triplea-game/triplea)
 * games.strategy.triplea.ai.pro.util.ProMatches — © TripleA contributors.
 * Licensed under the GNU General Public License v3.0 or later.
 *
 * Slimmed port: only the predicate factories with meaning in our engine.
 * Dropped (no equivalent in our model): territory effects, paratrooper /
 * blitz-through chains, canal-validation predicates beyond gate checks,
 * "can't be held" lists (a planner concern), and the ProPurchase* overloads.
 */
import type { GameState, PowerId, UnitTypeId } from "../../types.js";
import { UNITS, hasFlag } from "../../data/units.js";
import { areAllied } from "../../data/powers.js";
import { areEnemies } from "../../rules/politics.js";
import { TERRITORY_INDEX, isSea, isLand } from "../../data/territories.js";

// ============================================================================
// ProMatches — predicate factories the downstream Pro planners lean on. In Java
// these return Predicate<Territory> / Predicate<Unit>; here a territory match is
// `(state, power) => (territoryId) => boolean` and a unit match is a plain
// `(state, power) => (UnitStack|{type,owner}) => boolean`. Curried on state so
// callers can reuse a predicate across a sweep of territories.
// ============================================================================

type TerritoryPredicate = (id: string) => boolean;
type UnitLike = { type: UnitTypeId; owner: PowerId };
type UnitPredicate = (u: UnitLike) => boolean;

const def = (t: UnitTypeId) => UNITS[t];

// --- unit predicates (Matches.unitIsX) -------------------------------------

export const unitIsLand = (u: UnitLike): boolean => def(u.type).domain === "land";
export const unitIsAir = (u: UnitLike): boolean => def(u.type).domain === "air";
export const unitIsSea = (u: UnitLike): boolean => def(u.type).domain === "sea";
export const unitIsStructure = (u: UnitLike): boolean => def(u.type).domain === "structure";
/** Factories / bases / AA — our analogue of Matches.unitIsInfrastructure. */
export const unitIsInfrastructure = (u: UnitLike): boolean =>
  def(u.type).domain === "structure" || u.type === "aa_gun";
export const unitIsNotInfrastructure = (u: UnitLike): boolean => !unitIsInfrastructure(u);
export const unitIsTransport = (u: UnitLike): boolean => hasFlag(u.type, "transports_land");
export const unitIsCarrier = (u: UnitLike): boolean => hasFlag(u.type, "carries_air");
export const unitCanProduceUnits = (u: UnitLike): boolean => hasFlag(u.type, "factory");

/** Matches.enemyUnit — owned by a power `player` is at war with. */
export const unitIsEnemyOf =
  (state: GameState, player: PowerId): UnitPredicate =>
  (u) =>
    areEnemies(state, u.owner, player);

/** ProMatches.unitIsEnemyNotNeutral — enemy unit that isn't a neutral garrison. */
export const unitIsEnemyNotNeutral =
  (state: GameState, player: PowerId): UnitPredicate =>
  (u) =>
    u.owner !== "Neutral" && areEnemies(state, u.owner, player);

/** ProMatches.unitIsEnemyAir. */
export const unitIsEnemyAir =
  (state: GameState, player: PowerId): UnitPredicate =>
  (u) =>
    unitIsAir(u) && areEnemies(state, u.owner, player);

/** ProMatches.unitIsEnemyNotLand. */
export const unitIsEnemyNotLand =
  (state: GameState, player: PowerId): UnitPredicate =>
  (u) =>
    !unitIsLand(u) && areEnemies(state, u.owner, player);

/** ProMatches.unitIsOwnedNotLand. */
export const unitIsOwnedNotLand =
  (player: PowerId): UnitPredicate =>
  (u) =>
    !unitIsLand(u) && u.owner === player;

/** ProMatches.unitIsAlliedNotOwned. */
export const unitIsAlliedNotOwned =
  (player: PowerId): UnitPredicate =>
  (u) =>
    u.owner !== player && areAllied(u.owner, player);

/** Matches.alliedUnit (owned counts as allied). */
export const unitIsAllied =
  (player: PowerId): UnitPredicate =>
  (u) =>
    u.owner === player || areAllied(u.owner, player);

// --- territory predicates (ProMatches.territoryX) --------------------------

const enemyUnitsHere = (state: GameState, id: string, player: PowerId): boolean =>
  (state.territories[id]?.units ?? []).some(
    (u) => areEnemies(state, u.owner, player) && u.count > 0,
  );

/** Matches.territoryIsWater. */
export const territoryIsWater: TerritoryPredicate = (id) => isSea(id);

/** Matches.territoryIsLand. */
export const territoryIsLand: TerritoryPredicate = (id) => isLand(id);

/** Matches.territoryHasEnemyUnits. */
export const territoryHasEnemyUnits =
  (state: GameState, player: PowerId): TerritoryPredicate =>
  (id) =>
    enemyUnitsHere(state, id, player);

/** Matches.territoryHasNoEnemyUnits. */
export const territoryHasNoEnemyUnits =
  (state: GameState, player: PowerId): TerritoryPredicate =>
  (id) =>
    !enemyUnitsHere(state, id, player);

/** Matches.isTerritoryEnemy — controlled by a power `player` is at war with. */
export const territoryIsEnemy =
  (state: GameState, player: PowerId): TerritoryPredicate =>
  (id) => {
    const c = state.territories[id]?.controller;
    return !!c && areEnemies(state, c, player);
  };

/** Matches.isTerritoryAllied — controller owned-by-`player` or allied. */
export const territoryIsAllied =
  (state: GameState, player: PowerId): TerritoryPredicate =>
  (id) => {
    const c = state.territories[id]?.controller;
    return !!c && (c === player || areAllied(c, player));
  };

/**
 * ProMatches.territoryCanMoveLandUnits (slimmed): a land territory that is not
 * blocked for `player`. Combat-move allows entering enemy land; non-combat does
 * not. Canal / restriction checks are delegated to movement.checkMove.
 */
export const territoryCanMoveLandUnits =
  (state: GameState, player: PowerId, isCombatMove: boolean): TerritoryPredicate =>
  (id) => {
    if (!isLand(id)) return false;
    if (isCombatMove) return true;
    return !enemyUnitsHere(state, id, player) && !territoryIsEnemy(state, player)(id);
  };

/** ProMatches.territoryCanPotentiallyMoveLandUnits — any passable land. */
export const territoryCanPotentiallyMoveLandUnits = (): TerritoryPredicate => (id) => isLand(id);

/** ProMatches.territoryCanMoveSeaUnits (slimmed): a sea zone, canal checks deferred. */
export const territoryCanMoveSeaUnits =
  (state: GameState, player: PowerId, isCombatMove: boolean): TerritoryPredicate =>
  (id) => {
    if (!isSea(id)) return false;
    if (isCombatMove) return true;
    // Non-combat: don't sail into a sea zone holding enemy units.
    return !enemyUnitsHere(state, id, player);
  };

const hasFactory = (state: GameState, id: string): boolean =>
  (state.territories[id]?.units ?? []).some((u) => hasFlag(u.type, "factory"));

/** ProMatches.territoryHasInfraFactoryAndIsLand. */
export const territoryHasFactoryAndIsLand =
  (state: GameState): TerritoryPredicate =>
  (id) =>
    isLand(id) && hasFactory(state, id);

/** ProMatches.territoryHasInfraFactoryAndIsEnemyLand. */
export const territoryHasEnemyFactory =
  (state: GameState, player: PowerId): TerritoryPredicate =>
  (id) =>
    isLand(id) && hasFactory(state, id) && territoryIsEnemy(state, player)(id);

/** ProMatches.territoryHasInfraFactoryAndIsOwnedLand. */
export const territoryHasOwnedFactory =
  (state: GameState, player: PowerId): TerritoryPredicate =>
  (id) =>
    isLand(id) && state.territories[id]?.controller === player && hasFactory(state, id);

/** ProMatches.territoryIsEnemyLand — enemy-controlled land. */
export const territoryIsEnemyLand =
  (state: GameState, player: PowerId): TerritoryPredicate =>
  (id) =>
    isLand(id) && territoryIsEnemy(state, player)(id);

/**
 * ProMatches.territoryIsEnemyNotNeutralLand — enemy land that is not a neutral
 * country and not held by the synthetic Neutral garrison power.
 */
export const territoryIsEnemyNotNeutralLand =
  (state: GameState, player: PowerId): TerritoryPredicate =>
  (id) => {
    if (!territoryIsEnemyLand(state, player)(id)) return false;
    if (TERRITORY_INDEX[id]?.neutral) return false;
    return state.territories[id]?.controller !== "Neutral";
  };

/** ProMatches.territoryIsEnemyOrHasEnemyUnits (water-aware). */
export const territoryIsEnemyOrHasEnemyUnits =
  (state: GameState, player: PowerId): TerritoryPredicate =>
  (id) =>
    territoryIsEnemy(state, player)(id) || enemyUnitsHere(state, id, player);
