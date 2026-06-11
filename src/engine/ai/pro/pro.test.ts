/*
 * Tests for the TripleA Pro AI foundation port (GPL-3.0, see sibling files).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameState, UnitStack } from "../../types.js";
import { createInitialState } from "../../rules/setup.js";
import { setWar } from "../../rules/politics.js";
import { calculateOdds, estimateAttackOdds } from "./ProOddsCalculator.js";
import { estimateStrengthDifference } from "./ProBattleUtils.js";
import { findTerritoryValues } from "./ProTerritoryValueUtils.js";
import { landDistance, distanceToNearestEnemyLand } from "./ProMapGraph.js";
import { buildProData } from "./ProData.js";

/** A fresh state with Germany & USSR at war (a convenient land belligerent pair). */
function warState(): GameState {
  const state = createInitialState(12345);
  setWar(state, "Germany", "SovietUnion");
  return state;
}

const stack = (type: UnitStack["type"], owner: UnitStack["owner"], count: number): UnitStack => ({
  type,
  owner,
  count,
});

test("odds: 10 inf + 5 art crush 1 inf (>90% win)", () => {
  const state = warState();
  const r = calculateOdds(
    state,
    "poland",
    "Germany",
    [stack("infantry", "Germany", 10), stack("artillery", "Germany", 5)],
    [stack("infantry", "SovietUnion", 1)],
  );
  assert.ok(r.winPercentage > 90, `expected >90, got ${r.winPercentage}`);
  assert.ok(r.hasLandUnitRemaining, "attacker should hold the land");
});

test("odds: 1 inf attacking 8 inf is hopeless (<15% win)", () => {
  const state = warState();
  const r = calculateOdds(
    state,
    "poland",
    "Germany",
    [stack("infantry", "Germany", 1)],
    [stack("infantry", "SovietUnion", 8)],
  );
  assert.ok(r.winPercentage < 15, `expected <15, got ${r.winPercentage}`);
});

test("odds: deterministic — same inputs twice give identical results", () => {
  const state = warState();
  const atk = () => [stack("infantry", "Germany", 4), stack("tank", "Germany", 2)];
  const def = () => [stack("infantry", "SovietUnion", 3)];
  const a = calculateOdds(state, "poland", "Germany", atk(), def());
  const b = calculateOdds(state, "poland", "Germany", atk(), def());
  assert.deepEqual(a, b);
});

test("odds: estimateAttackOdds fast-path agrees on lopsided fights", () => {
  const state = warState();
  const easy = estimateAttackOdds(
    state,
    "poland",
    "Germany",
    [stack("tank", "Germany", 12)],
    [stack("infantry", "SovietUnion", 1)],
  );
  assert.equal(easy.winPercentage, 100);
  const hard = estimateAttackOdds(
    state,
    "poland",
    "Germany",
    [stack("infantry", "Germany", 1)],
    [stack("infantry", "SovietUnion", 12)],
  );
  assert.equal(hard.winPercentage, 0);
});

test("strengthDifference: ~50 when equal, higher for bigger army", () => {
  const state = warState();
  const equal = estimateStrengthDifference(
    state,
    "poland",
    [stack("infantry", "Germany", 5)],
    [stack("infantry", "SovietUnion", 5)],
  );
  // Equal counts: attacker (atk 1) is weaker than defender (def 2), so <50.
  const big = estimateStrengthDifference(
    state,
    "poland",
    [stack("infantry", "Germany", 20)],
    [stack("infantry", "SovietUnion", 5)],
  );
  const small = estimateStrengthDifference(
    state,
    "poland",
    [stack("infantry", "Germany", 2)],
    [stack("infantry", "SovietUnion", 5)],
  );
  assert.ok(big > small, `bigger army should score higher: ${big} vs ${small}`);
  assert.ok(big > 50, `dominant attacker should exceed 50, got ${big}`);
  // Symmetric, equal-stat armies (tanks both sides) should land near 50.
  const evenTanks = estimateStrengthDifference(
    state,
    "poland",
    [stack("tank", "Germany", 5)],
    [stack("tank", "SovietUnion", 5)],
  );
  void equal;
  assert.ok(Math.abs(evenTanks - 50) < 12, `even tanks ~50, got ${evenTanks}`);
});

test("territory values: enemy capitals positive and above plain land", () => {
  const state = warState();
  // Make sure all majors are mutually at war so capitals register as enemy.
  setWar(state, "Germany", "UnitedKingdom");
  setWar(state, "Germany", "UnitedStates");
  const check = ["russia", "germany", "poland", "novosibirsk", "sakha"];
  const values = findTerritoryValues(state, "Germany", check);
  // The enemy capital is reachable over land and earns a solid positive value.
  assert.ok(values["russia"] > 0, `enemy capital russia should be >0, got ${values["russia"]}`);
  // It out-values a remote enemy province far from any front (sakha, NE Siberia).
  assert.ok(
    values["russia"] > values["sakha"],
    `capital ${values["russia"]} should exceed remote land ${values["sakha"]}`,
  );
  // Frontline land (near multiple enemy production tiles) is also valued highly,
  // matching TripleA's nearby-production weighting.
  assert.ok(values["novosibirsk"] > 0, `frontline land should be >0`);
});

test("map graph: Germany adjacent to Poland (distance 1)", () => {
  const state = warState();
  const dist = landDistance(state, "germany", "Germany");
  assert.equal(dist["germany"], 0);
  assert.equal(dist["poland"], 1, `poland should be 1 hop from germany, got ${dist["poland"]}`);
  // Some enemy land must be reachable from the German capital.
  const toEnemy = distanceToNearestEnemyLand(state, "germany", "Germany");
  assert.ok(toEnemy >= 1 && toEnemy < Infinity, `nearest enemy land should be finite, got ${toEnemy}`);
});

test("ProData: snapshot has capital, enemy capitals and unit territories", () => {
  const state = warState();
  const pd = buildProData(state, "Germany");
  assert.equal(pd.myCapital, "germany");
  assert.ok(pd.enemyCapitals.includes("russia"), "russia is a live enemy capital");
  assert.ok(pd.myUnitTerritories.includes("germany"), "Germany has units at home");
  assert.equal(pd.unitValue["infantry"], 3);
  assert.ok(pd.minCostPerHitPoint <= 3, "infantry sets the cheapest cost/HP");
});
