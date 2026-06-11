/*
 * Ported from TripleA (https://github.com/triplea-game/triplea)
 * games.strategy.triplea.ai.pro.util.ProOddsCalculator — © TripleA contributors.
 * Licensed under the GNU General Public License v3.0 or later.
 *
 * Adapted to our deterministic combat simulator (rules/combat.resolveBattle)
 * instead of TripleA's IBattleCalculator. Faithfully ported: the runCount =
 * max(16, 100 - minArmySize) sample size, the estimate "no chance" shortcuts
 * (strengthDifference < 45 => attacker hopeless; > 55 => defender hopeless),
 * the win-percentage / average-survivors / TUV-swing statistics, and the
 * hasLandUnitRemaining flag. Degraded: AggregateResults' submerge bookkeeping
 * and territory effects (not modelled); our resolveBattle already handles
 * scramble / opening fire / two-hit ships internally.
 */
import type { GameState, PowerId, UnitStack } from "../../types.js";
import { UNITS } from "../../data/units.js";
import { isSea } from "../../data/territories.js";
import { setWar } from "../../rules/politics.js";
import { resolveBattle } from "../../rules/combat.js";
import { estimateStrengthDifference } from "./ProBattleUtils.js";

// ============================================================================
// ProOddsCalculator — Monte-Carlo battle odds over our own engine. For each of
// `runCount` samples we fork a minimal GameState (the battle territory holds the
// given attacker + defender stacks, a battle entry is queued, the two powers are
// at war), reseed its RNG to a hashed value, run resolveBattle to conclusion,
// and accumulate win / TUV / survivor statistics. Deterministic: the same
// inputs (including the source state's seed+counter) yield identical results.
// ============================================================================

export interface ProBattleResult {
  /** Probability (0..100) the attacker takes the territory / clears the sea zone. */
  winPercentage: number;
  /** TUV swing = attacker TUV lost − defender TUV lost (positive = good attack). */
  tuvSwing: number;
  averageAttackersRemaining: number;
  averageDefendersRemaining: number;
  /** True if, on average, an attacking unit (land, on land) survives a win. */
  hasLandUnitRemaining: boolean;
}

const EMPTY: ProBattleResult = {
  winPercentage: 0,
  tuvSwing: 0,
  averageAttackersRemaining: 0,
  averageDefendersRemaining: 0,
  hasLandUnitRemaining: false,
};

const tuv = (stacks: UnitStack[]): number =>
  stacks.reduce((s, u) => s + UNITS[u.type].cost * u.count, 0);

const countUnits = (stacks: UnitStack[]): number => stacks.reduce((s, u) => s + u.count, 0);

const isInfra = (stacks: UnitStack[]): boolean =>
  stacks.every((u) => UNITS[u.type].domain === "structure" || u.type === "aa_gun");

/** Small integer hash so each sample gets an independent, reproducible seed. */
function hash(seed: number, counter: number, i: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ counter, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ i, 0xc2b2ae35) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * Build a forked state template once: clone, strip the territory to exactly the
 * given attacker + defender stacks, ensure the two powers are at war, queue the
 * battle, and clear unrelated combat. Each sample structuredClones this and
 * reseeds before resolving.
 */
function buildTemplate(
  state: GameState,
  territory: string,
  attacker: PowerId,
  attackingUnits: UnitStack[],
  defendingUnits: UnitStack[],
): GameState {
  const template = structuredClone(state);
  const ts = template.territories[territory];
  const defender = defendingUnits[0]?.owner ?? "Neutral";
  // Sea zones have no controller; land keeps its controller as the defender's.
  if (!isSea(territory)) ts.controller = defender === "Neutral" ? ts.controller : defender;
  ts.units = [
    ...attackingUnits.map((u) => ({ ...u })),
    ...defendingUnits.map((u) => ({ ...u })),
  ].filter((u) => u.count > 0);
  if (defender !== "Neutral") setWar(template, attacker, defender);
  template.combat = {
    battles: [{ territory, attacker, defender, resolved: false }],
  };
  template.activePower = attacker;
  template.phase = "combat";
  return template;
}

/**
 * Simulate the battle `runCount` times and aggregate the statistics. runCount
 * defaults to max(16, 100 - minArmySize) exactly as in the Java.
 */
export function calculateOdds(
  state: GameState,
  territory: string,
  attacker: PowerId,
  attackingUnits: UnitStack[],
  defendingUnits: UnitStack[],
  runCount?: number,
): ProBattleResult {
  const atkCount = countUnits(attackingUnits);
  const defCount = countUnits(defendingUnits);
  if (atkCount === 0) return { ...EMPTY };

  // No real defenders: certain win (attacker keeps everything).
  if (defCount === 0 || isInfra(defendingUnits)) {
    const sea = isSea(territory);
    return {
      winPercentage: 100,
      tuvSwing: tuv(defendingUnits),
      averageAttackersRemaining: atkCount,
      averageDefendersRemaining: 0,
      hasLandUnitRemaining: sea
        ? atkCount > 0
        : attackingUnits.some((u) => UNITS[u.type].domain === "land"),
    };
  }

  const minArmySize = Math.min(atkCount, defCount);
  const runs = runCount ?? Math.max(16, 100 - minArmySize);

  const template = buildTemplate(state, territory, attacker, attackingUnits, defendingUnits);
  const startTuv = { atk: tuv(attackingUnits), def: tuv(defendingUnits) };
  const sea = isSea(territory);

  let wins = 0;
  let totalAtkRemaining = 0;
  let totalDefRemaining = 0;
  let totalAtkTuvLost = 0;
  let totalDefTuvLost = 0;
  let landRemainingSamples = 0;

  for (let i = 0; i < runs; i++) {
    const fork = structuredClone(template);
    fork.rng = { seed: hash(state.rng.seed, state.rng.counter, i), counter: 0 };
    const result = resolveBattle(fork, territory);

    const ts = fork.territories[territory];
    const atkSurvivors = ts.units.filter((u) => u.owner === attacker);
    const defSurvivors = ts.units.filter((u) => u.owner !== attacker);

    if (result.winner === "attacker") wins += 1;
    totalAtkRemaining += countUnits(atkSurvivors);
    totalDefRemaining += countUnits(defSurvivors);
    totalAtkTuvLost += startTuv.atk - tuv(atkSurvivors);
    totalDefTuvLost += startTuv.def - tuv(defSurvivors);

    const landLeft = sea
      ? atkSurvivors.length > 0
      : atkSurvivors.some((u) => UNITS[u.type].domain === "land");
    if (landLeft) landRemainingSamples += 1;
  }

  const avgAtkTuvLost = totalAtkTuvLost / runs;
  const avgDefTuvLost = totalDefTuvLost / runs;
  return {
    winPercentage: (wins / runs) * 100,
    tuvSwing: avgDefTuvLost - avgAtkTuvLost,
    averageAttackersRemaining: totalAtkRemaining / runs,
    averageDefendersRemaining: totalDefRemaining / runs,
    hasLandUnitRemaining: landRemainingSamples > runs / 2,
  };
}

/**
 * Fast path mirroring estimateAttackBattleResults: short-circuit to a defender
 * win when the attacker has almost no chance (strengthDifference < 45), and to
 * an attacker win when the defender has almost no chance (> 55, only-air vs land
 * being the exception). Otherwise delegate to the full simulation.
 */
export function estimateAttackOdds(
  state: GameState,
  territory: string,
  attacker: PowerId,
  attackingUnits: UnitStack[],
  defendingUnits: UnitStack[],
  runCount?: number,
): ProBattleResult {
  if (countUnits(attackingUnits) === 0) return { ...EMPTY };
  if (countUnits(defendingUnits) === 0 || isInfra(defendingUnits)) {
    return calculateOdds(state, territory, attacker, attackingUnits, defendingUnits, runCount);
  }

  const diff = estimateStrengthDifference(state, territory, attackingUnits, defendingUnits);
  if (diff < 45) {
    return {
      winPercentage: 0,
      tuvSwing: -999,
      averageAttackersRemaining: 0,
      averageDefendersRemaining: countUnits(defendingUnits),
      hasLandUnitRemaining: false,
    };
  }
  if (diff > 55) {
    const sea = isSea(territory);
    const onlyAirVsLand =
      !sea && attackingUnits.every((u) => UNITS[u.type].domain === "air");
    return {
      winPercentage: 100,
      tuvSwing: 999,
      averageAttackersRemaining: countUnits(attackingUnits),
      averageDefendersRemaining: 0,
      hasLandUnitRemaining: !onlyAirVsLand,
    };
  }
  return calculateOdds(state, territory, attacker, attackingUnits, defendingUnits, runCount);
}
