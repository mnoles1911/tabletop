/*
 * Ported from TripleA (https://github.com/triplea-game/triplea)
 * games.strategy.triplea.ai.pro.ProCombatMoveAi — © TripleA contributors.
 * Licensed under the GNU General Public License v3.0 or later.
 *
 * The combat-move planner. Faithful to the Java's pipeline:
 *   populateAttackOptions → prioritizeAttackOptions (attackValue formula) →
 *   tryToAttackTerritories (allocate minimal sufficient forces per target until
 *   the odds threshold is met) → removeAttacksUntilCapitalCanBeHeld (capital
 *   safety) → calculateMoveActions.
 *
 * Simplified vs Java (documented in README): unit allocation works at stack
 * granularity (add stacks cheapest-strength-first) rather than per-Unit; the
 * "can be held" recursion is reduced to a single capital-safety pass; territory
 * value comes from ProTerritoryValueUtils.findTerritoryAttackValue plus the
 * capital/factory multipliers; odds use estimateAttackOdds (fast path) and a
 * bounded number of full simulations per phase.
 */
import type { GameState, PowerId, UnitStack, UnitTypeId } from "../../types.js";
import type { Action } from "../../rules/actions.js";
import { UNITS } from "../../data/units.js";
import { POWERS } from "../../data/powers.js";
import { areEnemies } from "../../rules/politics.js";
import { isSea, isLand, TERRITORY_INDEX } from "../../data/territories.js";
import { buildProData, type ProData } from "./ProData.js";
import { populateAttackOptions, populateEnemyAttackOptions } from "./ProTerritoryManager.js";
import { findTerritoryAttackValue } from "./ProTerritoryValueUtils.js";
import { estimateAttackOdds, type ProBattleResult } from "./ProOddsCalculator.js";
import { calculateMoveActions } from "./ProMoveUtils.js";
import {
  type ProTerritory,
  type ProUnitOption,
  addUnit,
  committedStacks,
  totalUnits,
} from "./ProTerritory.js";

// Bound the number of full odds simulations per combat-move plan so the all-AI
// smoke test stays well under its action / time budget. The estimate fast path
// resolves most lopsided fights for free; only borderline fights pay for a sim.
const MAX_FULL_SIMS = 40;

/** Strength rank of a unit type for cheapest-first allocation (cost, then attack). */
function allocRank(type: UnitTypeId): number {
  return UNITS[type].cost * 100 - UNITS[type].attack;
}

/** Owner-tagged stacks for a list of unit options (for the odds calculator). */
function asStacks(opts: ProUnitOption[], owner: PowerId): UnitStack[] {
  return opts.map((o) => ({ type: o.type, owner, count: o.count }));
}

/** The defending stacks currently sitting in a target territory (enemies of `power`). */
function defenderStacks(state: GameState, power: PowerId, territoryId: string): UnitStack[] {
  return (state.territories[territoryId]?.units ?? [])
    .filter((u) => areEnemies(state, u.owner, power) && u.count > 0)
    .map((u) => ({ type: u.type, owner: u.owner, count: u.count }));
}

/** Is the target an enemy capital still held by its owner? */
function isEnemyCapital(state: GameState, power: PowerId, territoryId: string): boolean {
  for (const p of Object.values(POWERS)) {
    if (p.capital === territoryId && areEnemies(state, p.id, power)) {
      return state.territories[territoryId]?.controller === p.id;
    }
  }
  return false;
}

function hasFactory(state: GameState, territoryId: string): boolean {
  return (state.territories[territoryId]?.units ?? []).some(
    (u) => u.type === "major_ic" || u.type === "minor_ic",
  );
}

const isNeutral = (territoryId: string): boolean => !!TERRITORY_INDEX[territoryId]?.neutral;

/**
 * attackValue — TripleA's prioritizeAttackOptions score, adapted:
 *   (tuvSwing + territoryValue) * (1 + 4*isCapital) * (1 + 2*hasFactory)
 *                              * (1 - 0.9*isNeutral)
 * territoryValue comes from findTerritoryAttackValue (3*production, factory x2,
 * neutral garrison penalty). We fold the win-percentage in as a multiplier so a
 * borderline fight ranks below a sure thing of equal value.
 */
function attackValue(
  state: GameState,
  pd: ProData,
  pt: ProTerritory,
  result: ProBattleResult,
): number {
  const t = pt.territoryId;
  const base = findTerritoryAttackValue(state, pd.player, t, pd.minCostPerHitPoint);
  const capital = isEnemyCapital(state, pd.player, t) ? 1 : 0;
  const factory = hasFactory(state, t) ? 1 : 0;
  const neutral = isNeutral(t) ? 1 : 0;
  const territoryValue = base * (1 + 4.0 * capital) * (1 + 2.0 * factory) * (1 - 0.9 * neutral);
  const winFactor = result.winPercentage / 100;
  return (result.tuvSwing + territoryValue) * winFactor;
}

/**
 * Estimate the battle for a committed plan against the territory's real defenders.
 * `budget` is decremented when a full simulation is paid for (vs the fast path).
 */
function estimate(
  state: GameState,
  pd: ProData,
  pt: ProTerritory,
  budget: { sims: number },
): ProBattleResult {
  const sea = isSea(pt.territoryId);
  const attackers = committedStacks(pt, pd.player).map((u) => ({
    type: u.type,
    owner: pd.player,
    count: u.count,
  }));
  const defenders = defenderStacks(state, pd.player, pt.territoryId);
  // Smaller run count when we still have simulation budget, else lean on the fast
  // estimate path (runCount 0 means estimateAttackOdds shortcuts unless borderline).
  const runCount = budget.sims > 0 ? undefined : 1;
  if (budget.sims > 0) budget.sims -= 1;
  return estimateAttackOdds(
    state,
    pt.territoryId,
    pd.player,
    attackers.length ? attackers : [{ type: "infantry", owner: pd.player, count: 0 }],
    defenders,
    runCount,
  );
  void sea;
}

/**
 * tryToAttackTerritories (stack-granularity): for one target, commit units from
 * its maxUnits cheapest-strength-first until the odds clear the threshold, then
 * stop (minimal sufficient force). Land targets also require a surviving land
 * unit so the territory is actually taken. Returns the achieved battle result.
 */
function allocateForces(
  state: GameState,
  pd: ProData,
  pt: ProTerritory,
  budget: { sims: number },
): ProBattleResult {
  const sea = isSea(pt.territoryId);
  // Sort available stacks cheapest-strength-first (Java adds inexpensive fodder
  // first, then quality). For land targets keep at least one land stack so we
  // can capture; air-only land attacks can't hold the ground.
  const pool = [...pt.maxUnits].sort((a, b) => allocRank(a.type) - allocRank(b.type));

  pt.units = [];
  pt.amphibUnits = [];
  let result: ProBattleResult = {
    winPercentage: 0,
    tuvSwing: 0,
    averageAttackersRemaining: 0,
    averageDefendersRemaining: 0,
    hasLandUnitRemaining: false,
  };

  // Always include any amphibious options for coastal land targets — they bring
  // bombardment and extra troops the land routes can't.
  if (!sea) pt.amphibUnits = [...pt.maxAmphibUnits];

  for (const opt of pool) {
    addUnit(pt, { from: opt.from, type: opt.type, count: opt.count });
    result = estimate(state, pd, pt, budget);
    const oddsOk = result.winPercentage >= pd.winPercentage;
    const landOk = sea || result.hasLandUnitRemaining;
    if (oddsOk && landOk) break;
  }
  pt.battleResult = result;
  return result;
}

/** A worthwhile attack: clears the win threshold, or min threshold with +TUV. */
function isWorthwhile(pd: ProData, pt: ProTerritory, result: ProBattleResult): boolean {
  const sea = isSea(pt.territoryId);
  if (totalUnits(pt.units) + pt.amphibUnits.reduce((n, a) => n + a.units.reduce((m, u) => m + u.count, 0), 0) === 0) {
    return false;
  }
  const landOk = sea || result.hasLandUnitRemaining;
  if (!landOk) return false;
  if (result.winPercentage >= pd.winPercentage) return true;
  // Riskier attack allowed down to minWinPercentage when the TUV swing is positive.
  return result.winPercentage >= pd.minWinPercentage && result.tuvSwing > 0;
}

/**
 * removeAttacksUntilCapitalCanBeHeld (single-pass): if committing these attacks
 * would strip the capital below the force needed to survive the worst enemy
 * counter-attack, drop attacks (lowest attackValue first) that draw units out of
 * the capital until it is safe again.
 */
function ensureCapitalSafety(
  state: GameState,
  pd: ProData,
  attacks: { pt: ProTerritory; score: number }[],
): void {
  const cap = pd.myCapital;
  if (!cap) return;

  // Worst-case enemy attack on the capital (max reachable enemy units).
  const enemyMap = populateEnemyAttackOptions(state, pd.player);
  const threat = enemyMap[cap];
  if (!threat) return; // capital not reachable by any enemy — nothing to defend against
  const enemyStacks: UnitStack[] = threat.maxUnits.map((u) => {
    const owner = state.territories[u.from]?.units.find((s) => s.type === u.type)?.owner ?? "Neutral";
    return { type: u.type, owner, count: u.count };
  });
  if (enemyStacks.length === 0) return;

  // Units currently garrisoning the capital that we have NOT committed elsewhere.
  const committedFromCapital = (): number => {
    let n = 0;
    for (const a of attacks) {
      for (const u of a.pt.units) if (u.from === cap) n += u.count;
      for (const am of a.pt.amphibUnits) if (am.from === cap) n += am.units.reduce((m, x) => m + x.count, 0);
    }
    return n;
  };

  const capDefenders = (): UnitStack[] => {
    const out: UnitStack[] = [];
    let toRemove = committedFromCapital();
    for (const s of state.territories[cap]?.units ?? []) {
      if (s.owner !== pd.player || s.count <= 0) continue;
      if (UNITS[s.type].domain === "structure" || s.type === "aa_gun") {
        out.push({ ...s });
        continue;
      }
      let c = s.count;
      if (toRemove > 0) {
        const take = Math.min(c, toRemove);
        c -= take;
        toRemove -= take;
      }
      if (c > 0) out.push({ type: s.type, owner: pd.player, count: c });
    }
    return out;
  };

  const safe = (): boolean => {
    const def = capDefenders();
    const r = estimateAttackOdds(state, cap, enemyStacks[0].owner, enemyStacks, def, 1);
    // The enemy "attacker" winning means our capital falls. Demand they stay below
    // the min win threshold (i.e. our defence holds with high probability).
    return r.winPercentage < 100 - pd.minWinPercentage;
  };

  // Drop lowest-value attacks that draw from the capital until it is safe.
  const ordered = [...attacks].sort((a, b) => a.score - b.score);
  let i = 0;
  while (!safe() && i < ordered.length) {
    const a = ordered[i];
    const drawsFromCapital =
      a.pt.units.some((u) => u.from === cap) || a.pt.amphibUnits.some((am) => am.from === cap);
    if (drawsFromCapital) {
      a.pt.units = [];
      a.pt.amphibUnits = [];
    }
    i += 1;
  }
}

/** Plan the combat-move phase: returns the ordered Action[] of attacks. */
export function planCombatMove(state: GameState): Action[] {
  const power = state.activePower;
  const pd = buildProData(state, power);

  // Manager needs the right phase/actor to validate routes.
  const cmState = state.phase === "combat_move" ? state : { ...state, phase: "combat_move" as const };
  const { moveMap } = populateAttackOptions(cmState, power);

  const candidates = Object.values(moveMap).filter((pt) => pt.canAttack);
  if (candidates.length === 0) return [];

  const budget = { sims: MAX_FULL_SIMS };

  // Allocate forces and score every candidate.
  const scored: { pt: ProTerritory; score: number; result: ProBattleResult }[] = [];
  for (const pt of candidates) {
    const result = allocateForces(state, pd, pt, budget);
    if (!isWorthwhile(pd, pt, result)) continue;
    const score = attackValue(state, pd, pt, result);
    if (score <= 0 && !isEnemyCapital(state, power, pt.territoryId)) continue;
    scored.push({ pt, score, result });
  }
  if (scored.length === 0) return [];

  // Prioritize by descending attackValue. Where two attacks want the same source
  // stack the engine validator (calculateMoveActions) drops the loser, so simply
  // committing in priority order gives the higher-value attack first claim.
  scored.sort((a, b) => b.score - a.score);

  ensureCapitalSafety(state, pd, scored);

  const plans = scored.map((s) => s.pt).filter((pt) => totalUnits(pt.units) > 0 || pt.amphibUnits.length > 0);
  if (plans.length === 0) return [];
  void isLand;
  return calculateMoveActions(state, power, plans, true);
}
