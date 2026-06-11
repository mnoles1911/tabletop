/*
 * Ported from TripleA (https://github.com/triplea-game/triplea)
 * games.strategy.triplea.ai.pro.data.ProTerritoryManager — © TripleA
 * contributors. Licensed under the GNU General Public License v3.0 or later.
 *
 * The targeting workhorse: for each candidate territory it finds the MAX set of
 * units that could legally reach it. The Java decomposes findAttackOptions into
 * naval / land / air / amphibious sub-searches over per-unit movement ranges and
 * map predicates, then validates routes via GameMap.getRouteForUnit. We keep the
 * same decomposition but delegate route legality to our authoritative
 * movement.checkMove / transport.checkTransport — fidelity of OUTPUT (the
 * correct max-unit sets) over line-by-line fidelity, as the brief requests.
 *
 * Pruning: ProMapGraph hop distances cut the candidate × source cross-product
 * (a unit of movement m can only reach a target within ~m+1 hops); each survivor
 * is then confirmed with the real validator on an appropriately-phased state.
 */
import type { GameState, PowerId, UnitTypeId } from "../../types.js";
import { UNITS } from "../../data/units.js";
import { POWERS, areAllied } from "../../data/powers.js";
import { areEnemies } from "../../rules/politics.js";
import { TERRITORIES, isSea, isLand } from "../../data/territories.js";
import { neighbours } from "../../rules/setup.js";
import { checkMove, movementAllowance } from "../../rules/movement.js";
import { checkTransport } from "../../rules/transport.js";
import {
  ProTerritory,
  createProTerritory,
  addMaxUnit,
  addMaxAmphibOption,
} from "./ProTerritory.js";
import { graphDistance, type GraphDomain } from "./ProMapGraph.js";
import { freeTransportCapacity, findBestUnitsToLoad, loadableLandUnits } from "./ProTransportUtils.js";

// ============================================================================
// ProTerritoryManager — populate{Attack,Defense,EnemyAttack}Options.
// ============================================================================

export interface ProTerritoryManagerResult {
  /** territoryId → ProTerritory holding its max reachable unit set. */
  moveMap: Record<string, ProTerritory>;
}

/** territoryId → max enemy units (by enemy power) that could reach it next turn. */
export type ProEnemyAttackMap = Record<string, ProTerritory>;

const domainOf = (type: UnitTypeId): GraphDomain => {
  const d = UNITS[type].domain;
  return d === "air" ? "air" : d === "sea" ? "sea" : "land";
};

/** Owned, mobile stacks at a territory grouped by type (skips immobile structures/AA). */
function mobileStacks(
  state: GameState,
  owner: PowerId,
  from: string,
): { type: UnitTypeId; count: number }[] {
  const out: { type: UnitTypeId; count: number }[] = [];
  for (const s of state.territories[from]?.units ?? []) {
    if (s.owner !== owner || s.count <= 0) continue;
    if (UNITS[s.type].immobileInCombatMove) continue;
    out.push({ type: s.type, count: s.count });
  }
  return out;
}

/** Territories where `power` currently has at least one mobile unit. */
function unitTerritories(state: GameState, power: PowerId): string[] {
  const out: string[] = [];
  for (const t of TERRITORIES) {
    if ((state.territories[t.id]?.units ?? []).some((u) => u.owner === power && u.count > 0)) {
      out.push(t.id);
    }
  }
  return out;
}

/**
 * findAttackOptions — for each candidate target, the max units that can legally
 * reach it. `targetFilter(id)` selects the candidate set (enemy land/sea for
 * attack; friendly for defence). `validate(from,to,type,count)` is the engine
 * check (checkMove for the right phase). Amphibious candidates are added for
 * coastal land targets when `includeAmphib`.
 */
function findAttackOptions(
  state: GameState,
  power: PowerId,
  sources: string[],
  isCandidate: (id: string) => boolean,
  validateMove: (from: string, to: string, type: UnitTypeId, count: number) => boolean,
  includeAmphib: boolean,
): Record<string, ProTerritory> {
  const moveMap: Record<string, ProTerritory> = {};
  const candidates = TERRITORIES.map((t) => t.id).filter(isCandidate);

  for (const from of sources) {
    const stacks = mobileStacks(state, power, from);
    if (stacks.length === 0) continue;

    for (const { type, count } of stacks) {
      const domain = domainOf(type);
      const allowance = movementAllowance(state, power, from, type);
      for (const to of candidates) {
        // Domain compatibility: land→land, sea→sea, air→either.
        if (domain === "land" && !isLand(to)) continue;
        if (domain === "sea" && !isSea(to)) continue;
        // Prune with hop distance before paying for the full validator.
        const hops = graphDistance(state, from, to, domain, power);
        if (hops > allowance + 1) continue;
        if (!validateMove(from, to, type, count)) continue;
        const pt = (moveMap[to] ??= createProTerritory(to));
        addMaxUnit(pt, { from, type, count });
      }
    }
  }

  if (includeAmphib) addAmphibiousOptions(state, power, candidates, moveMap);
  return moveMap;
}

/**
 * For each coastal land candidate, look at every adjacent sea zone with our
 * transports; for each such zone find an adjacent friendly coastal load
 * territory and the best units to load within free capacity, validated by
 * checkTransport. Mirrors the Java amphibious BFS, slimmed to one-zone hops
 * (our transport model is a single load→via→to lift).
 */
function addAmphibiousOptions(
  state: GameState,
  power: PowerId,
  candidates: string[],
  moveMap: Record<string, ProTerritory>,
): void {
  for (const to of candidates) {
    if (!isLand(to)) continue;
    for (const via of neighbours(to)) {
      if (!isSea(via)) continue;
      const capacity = freeTransportCapacity(state, power, via);
      if (capacity <= 0) continue;
      for (const from of neighbours(via)) {
        if (from === to || isSea(from)) continue;
        // Load territory must be friendly-controlled (you can't board from enemy land).
        const lc = state.territories[from]?.controller;
        if (lc && lc !== power && !areAllied(lc, power)) continue;
        const loadable = loadableLandUnits(state, power, from);
        const units = findBestUnitsToLoad(loadable, capacity);
        if (units.length === 0) continue;
        const check = checkTransport(state, power, { from, via, to, units });
        if (!check.ok) continue;
        const pt = (moveMap[to] ??= createProTerritory(to));
        addMaxAmphibOption(pt, { from, via, units });
      }
    }
  }
}

/**
 * populateAttackOptions — every territory holding enemy units or under
 * enemy/neutral control reachable this combat move, with the max set of my units
 * that can legally reach it (including amphibious for coastal land targets).
 * Must be called with state.phase === "combat_move" and activePower === power.
 */
export function populateAttackOptions(
  state: GameState,
  power: PowerId,
): ProTerritoryManagerResult {
  const isEnemyTarget = (id: string): boolean => {
    const ts = state.territories[id];
    if (!ts) return false;
    if (ts.units.some((u) => areEnemies(state, u.owner, power) && u.count > 0)) return true;
    const c = ts.controller;
    return isLand(id) && !!c && areEnemies(state, c, power);
  };
  const validate = (from: string, to: string, type: UnitTypeId, count: number): boolean =>
    checkMove(state, power, { from, to, type, count }).ok;
  const moveMap = findAttackOptions(state, power, unitTerritories(state, power), isEnemyTarget, validate, true);
  return { moveMap };
}

/**
 * populateDefenseOptions — which of my units can reach each given friendly
 * territory as non-combat reinforcement. Validation uses a clone whose phase is
 * noncombat_move (so checkMove rejects enemy-occupied destinations and applies
 * non-combat rules) with activePower set to `power`.
 */
export function populateDefenseOptions(
  state: GameState,
  power: PowerId,
  territories: string[],
): ProTerritoryManagerResult {
  const ncState = structuredClone(state);
  ncState.phase = "noncombat_move";
  ncState.activePower = power;
  const targetSet = new Set(territories.filter((id) => isLand(id)));
  const isFriendlyTarget = (id: string): boolean => targetSet.has(id);
  const validate = (from: string, to: string, type: UnitTypeId, count: number): boolean =>
    checkMove(ncState, power, { from, to, type, count }).ok;
  // Sources come from the original state's unit territories (same units).
  const moveMap = findAttackOptions(
    ncState,
    power,
    unitTerritories(ncState, power),
    isFriendlyTarget,
    validate,
    false,
  );
  return { moveMap };
}

/** All powers `enemy-or-potential-enemy` of `power` under the CURRENT war matrix. */
function enemyPowers(state: GameState, power: PowerId): PowerId[] {
  return (Object.values(POWERS) as { id: PowerId }[])
    .map((p) => p.id)
    .filter((id) => id !== "Neutral" && id !== power && areEnemies(state, id, power));
}

/**
 * populateEnemyAttackOptions — max enemy units that could reach each of my
 * territories next turn. Flips perspective to every current enemy: clones the
 * state, sets phase=combat_move and activePower=that enemy, runs the same attack
 * machinery, and merges each enemy's reach into a single map keyed by my
 * territory. Uses only the current war matrix (no speculative declarations).
 */
export function populateEnemyAttackOptions(
  state: GameState,
  power: PowerId,
): ProEnemyAttackMap {
  const myTerritories = new Set(
    TERRITORIES.map((t) => t.id).filter((id) => {
      const ts = state.territories[id];
      return (
        (isLand(id) && ts?.controller === power) ||
        (ts?.units ?? []).some((u) => u.owner === power && u.count > 0)
      );
    }),
  );

  const merged: ProEnemyAttackMap = {};
  for (const enemy of enemyPowers(state, power)) {
    const enemyState = structuredClone(state);
    enemyState.phase = "combat_move";
    enemyState.activePower = enemy;
    const isMine = (id: string): boolean => myTerritories.has(id);
    const validate = (from: string, to: string, type: UnitTypeId, count: number): boolean =>
      checkMove(enemyState, enemy, { from, to, type, count }).ok;
    const map = findAttackOptions(
      enemyState,
      enemy,
      unitTerritories(enemyState, enemy),
      isMine,
      validate,
      true,
    );
    for (const [tid, pt] of Object.entries(map)) {
      const dest = (merged[tid] ??= createProTerritory(tid));
      for (const u of pt.maxUnits) addMaxUnit(dest, u);
      for (const a of pt.maxAmphibUnits) addMaxAmphibOption(dest, a);
    }
  }
  return merged;
}
