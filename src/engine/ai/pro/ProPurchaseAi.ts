/*
 * Ported from TripleA (https://github.com/triplea-game/triplea)
 * games.strategy.triplea.ai.pro.ProPurchaseAi — © TripleA contributors.
 * Licensed under the GNU General Public License v3.0 or later.
 *
 * Pragmatic-fidelity port. Java's purchase pipeline:
 *   repair factories → purchaseDefenders (threatened factories, defenseEfficiency)
 *   → purchaseLandUnits (attackEfficiency, artillery/infantry pairing, some armour)
 *   → purchaseAirUnits (when IPC-rich) → purchaseSeaAndAmphib (when a fleet
 *   threatens or transports are needed). We keep that ORDER and the efficiency
 *   rankings (ProPurchaseUtils), simplified: one consolidated buy action; the
 *   "needs analysis" for naval is reduced to "an enemy fleet threatens a home
 *   sea zone". Placement (place()) mirrors Java's placement: defenders at
 *   threatened factories first, the rest near the front, naval into the most
 *   useful adjacent sea zone, respecting remainingCapacity.
 */
import type { GameState, PowerId, UnitTypeId } from "../../types.js";
import type { Action } from "../../rules/actions.js";
import { UNITS } from "../../data/units.js";
import { POWERS, areAllied } from "../../data/powers.js";
import { areEnemies } from "../../rules/politics.js";
import { isSea, isLand, TERRITORIES } from "../../data/territories.js";
import { neighbours } from "../../rules/setup.js";
import { remainingCapacity } from "../../rules/phases.js";
import { buildProData, type ProData } from "./ProData.js";
import { populateEnemyAttackOptions } from "./ProTerritoryManager.js";
import {
  findLandPurchaseOptions,
  findSeaPurchaseOptions,
  findAirPurchaseOptions,
  findPlaceTerritories,
  type ProPurchaseOption,
} from "./ProPurchaseUtils.js";
import { distanceToNearestEnemyLand } from "./ProMapGraph.js";

function hasFactory(state: GameState, id: string): boolean {
  return (state.territories[id]?.units ?? []).some(
    (u) => u.type === "major_ic" || u.type === "minor_ic",
  );
}

/** Factory territories `power` controls. */
function myFactories(state: GameState, power: PowerId): string[] {
  return TERRITORIES.filter(
    (t) => state.territories[t.id]?.controller === power && hasFactory(state, t.id),
  ).map((t) => t.id);
}

/** Is the capital under a serious threat next turn (enemy can reach it)? */
function capitalThreatened(
  enemyMap: Record<string, { maxUnits: { count: number }[] }>,
  pd: ProData,
): boolean {
  if (!pd.myCapital) return false;
  const threat = enemyMap[pd.myCapital];
  return !!threat && threat.maxUnits.reduce((n, u) => n + u.count, 0) >= 3;
}

/** Does an enemy fleet threaten one of my home sea zones (warships adjacent)? */
function enemyFleetThreat(state: GameState, power: PowerId): boolean {
  const myCoastalSeas = new Set<string>();
  for (const t of TERRITORIES) {
    if (state.territories[t.id]?.controller !== power) continue;
    for (const n of neighbours(t.id)) if (isSea(n)) myCoastalSeas.add(n);
  }
  for (const sz of myCoastalSeas) {
    const enemyWarships = (state.territories[sz]?.units ?? []).some(
      (u) =>
        areEnemies(state, u.owner, power) &&
        u.count > 0 &&
        UNITS[u.type].domain === "sea" &&
        UNITS[u.type].attack > 0,
    );
    if (enemyWarships) return true;
  }
  return false;
}

/** Greedily buy from `options` ranked by `key`, honouring artillery/infantry pairing. */
function buyRanked(
  options: ProPurchaseOption[],
  key: (o: ProPurchaseOption) => number,
  budgetRef: { ipc: number },
  cart: Map<UnitTypeId, number>,
  maxSpend: number,
  pairArtillery: boolean,
): void {
  const ranked = [...options].sort((a, b) => key(b) - key(a));
  if (ranked.length === 0) return;
  let spent = 0;
  const inf = ranked.find((o) => o.type === "infantry");
  const art = ranked.find((o) => o.type === "artillery");

  let guard = 0;
  while (spent < maxSpend && budgetRef.ipc > 0 && guard++ < 500) {
    // Artillery/infantry pairing: keep roughly one artillery per infantry so
    // infantry attack at 2 (the engine pairs them automatically in combat).
    if (pairArtillery && inf && art) {
      const infCount = cart.get("infantry") ?? 0;
      const artCount = cart.get("artillery") ?? 0;
      const want = artCount < infCount ? art : inf;
      if (want.cost <= budgetRef.ipc && spent + want.cost <= maxSpend) {
        cart.set(want.type, (cart.get(want.type) ?? 0) + 1);
        budgetRef.ipc -= want.cost;
        spent += want.cost;
        continue;
      }
    }
    // Otherwise buy the best-ranked affordable option.
    const pick = ranked.find((o) => o.cost <= budgetRef.ipc && spent + o.cost <= maxSpend);
    if (!pick) break;
    cart.set(pick.type, (cart.get(pick.type) ?? 0) + 1);
    budgetRef.ipc -= pick.cost;
    spent += pick.cost;
  }
}

/** Plan the purchase phase: one consolidated buy plus any factory repairs. */
export function planPurchase(state: GameState): Action[] {
  const power = state.activePower;
  const pd = buildProData(state, power);
  const actions: Action[] = [];
  const budget = { ipc: state.treasury[power] ?? 0 };
  if (budget.ipc <= 0) return [];

  // 1) Repair damaged factories first (cheap, restores production capacity).
  for (const id of myFactories(state, power)) {
    const dmg = state.territories[id]?.factoryDamage ?? 0;
    if (dmg <= 0) continue;
    const cost = Math.min(dmg, budget.ipc);
    if (cost <= 0) break;
    actions.push({ kind: "repair", territory: id, amount: cost });
    budget.ipc -= cost;
  }

  const cart = new Map<UnitTypeId, number>();
  const land = findLandPurchaseOptions(power).filter((o) => !o.isInfrastructure);
  const air = findAirPurchaseOptions(power);
  const sea = findSeaPurchaseOptions(power);

  if (power === "China") {
    // China is infantry-only; spend it all on infantry.
    buyRanked(land, (o) => o.defenseEfficiency, budget, cart, budget.ipc, false);
    return finishBuy(actions, cart);
  }

  const enemyMap = populateEnemyAttackOptions(state, power);

  // 2) Defence first when the capital is threatened — defenseEfficiency-ranked land.
  if (capitalThreatened(enemyMap, pd)) {
    const half = (state.treasury[power] ?? 0) * 0.6;
    buyRanked(land, (o) => o.defenseEfficiency, budget, cart, half, false);
  }

  // 3) Naval only when an enemy fleet threatens (defensive screen) — cap the spend.
  if (sea.length > 0 && enemyFleetThreat(state, power)) {
    const navalBudget = Math.min(budget.ipc, (state.treasury[power] ?? 0) * 0.3);
    buyRanked(
      sea.filter((o) => o.type !== "transport"),
      (o) => o.defenseEfficiency,
      budget,
      cart,
      navalBudget,
      false,
    );
  }

  // 4) Air when IPC-rich (lots of treasury relative to a fighter's cost).
  if (air.length > 0 && budget.ipc >= 30) {
    const airBudget = Math.min(budget.ipc, (state.treasury[power] ?? 0) * 0.25);
    buyRanked(air, (o) => o.attackEfficiency, budget, cart, airBudget, false);
  }

  // 5) Attack-efficiency land mix (infantry+artillery pairing, some armour) for
  //    the remaining treasury.
  buyRanked(land, (o) => o.attackEfficiency, budget, cart, budget.ipc, true);

  return finishBuy(actions, cart);
}

function finishBuy(actions: Action[], cart: Map<UnitTypeId, number>): Action[] {
  const units = [...cart.entries()]
    .filter(([, count]) => count > 0)
    .map(([type, count]) => ({ type, count }));
  if (units.length > 0) actions.push({ kind: "buy", units });
  return actions;
}

// ============================================================================
// Placement (mobilize phase). One {kind:"place"} action per unit. Defenders go
// to threatened factories first, builders to the factory nearest the front,
// naval to the most useful adjacent sea zone — respecting remainingCapacity.
// ============================================================================

export function planPlace(state: GameState): Action[] {
  const power = state.activePower;
  const pd = buildProData(state, power);
  const out: Action[] = [];

  // What is left to place this turn.
  const pending = new Map<UnitTypeId, number>();
  for (const p of state.purchases) if (p.count > 0) pending.set(p.type, p.count);
  if (pending.size === 0) return [];

  const places = findPlaceTerritories(state, power);
  const landFactories = places.filter((p) => !p.isSea);
  const seaZones = places.filter((p) => p.isSea);

  const enemyMap = populateEnemyAttackOptions(state, power);
  const threatOf = (id: string): number =>
    (enemyMap[id]?.maxUnits ?? []).reduce((n, u) => n + u.count, 0);

  // Factory placement order: threatened (incl. capital) first, then nearest the
  // front. Track a mutable remaining-capacity per factory.
  const cap = new Map<string, number>();
  for (const f of landFactories) cap.set(f.territoryId, remainingCapacity(state, power, f.territoryId));

  const factoryOrder = [...landFactories]
    .map((f) => ({
      id: f.territoryId,
      threat: threatOf(f.territoryId) + (f.territoryId === pd.myCapital ? 1000 : 0),
      front: distanceToNearestEnemyLand(state, f.territoryId, power),
    }))
    .sort((a, b) => b.threat - a.threat || a.front - b.front);

  // Classify pending units.
  const seaTypes: UnitTypeId[] = [];
  const airLandTypes: UnitTypeId[] = [];
  for (const [type] of pending) {
    if (UNITS[type].domain === "sea") seaTypes.push(type);
    else if (UNITS[type].domain === "structure") airLandTypes.push(type); // place where legal
    else airLandTypes.push(type);
  }

  // Place land/air units across factories in priority order.
  for (const f of factoryOrder) {
    for (const type of airLandTypes) {
      let left = pending.get(type) ?? 0;
      while (left > 0 && (cap.get(f.id) ?? 0) > 0) {
        out.push({ kind: "place", unit: type, territory: f.id });
        cap.set(f.id, (cap.get(f.id) ?? 0) - 1);
        left -= 1;
        pending.set(type, left);
      }
    }
  }

  // Place naval units into the most useful adjacent sea zone (one with the most
  // capacity backing / nearest a threat). Sea placement consumes the feeding
  // factory's capacity, so iterate factories that still have room.
  for (const type of seaTypes) {
    let left = pending.get(type) ?? 0;
    if (left <= 0) continue;
    // Prefer a sea zone adjacent to a factory that still has capacity.
    const usableSeas = seaZones
      .map((s) => ({
        id: s.territoryId,
        threat: threatOf(s.territoryId),
        feeder: neighbours(s.territoryId).find(
          (n) => isLand(n) && (cap.get(n) ?? 0) > 0,
        ),
      }))
      .filter((s) => s.feeder)
      .sort((a, b) => b.threat - a.threat);
    for (const s of usableSeas) {
      while (left > 0 && s.feeder && (cap.get(s.feeder) ?? 0) > 0) {
        out.push({ kind: "place", unit: type, territory: s.id });
        cap.set(s.feeder, (cap.get(s.feeder) ?? 0) - 1);
        left -= 1;
        pending.set(type, left);
      }
      if (left <= 0) break;
    }
  }

  void areAllied;
  void POWERS;
  return out;
}
