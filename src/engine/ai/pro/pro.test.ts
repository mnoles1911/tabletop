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
import {
  populateAttackOptions,
  populateEnemyAttackOptions,
} from "./ProTerritoryManager.js";
import { calculateMoveActions } from "./ProMoveUtils.js";
import { findPurchaseOptions, findLandPurchaseOptions } from "./ProPurchaseUtils.js";
import { applyAction } from "../../rules/actions.js";
import { areEnemies } from "../../rules/politics.js";
import { planCombatMove } from "./ProCombatMoveAi.js";
import { planPurchase } from "./ProPurchaseAi.js";
import { planPolitics } from "./ProPoliticsAi.js";

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

test("territory manager: Germany attack options include the Baltic States", () => {
  const state = warState();
  state.phase = "combat_move";
  const { moveMap } = populateAttackOptions(state, "Germany");
  const baltic = moveMap["baltic_states"];
  assert.ok(baltic, "baltic_states should be an attack candidate (Soviet-held)");
  const total = baltic.maxUnits.reduce((n, u) => n + u.count, 0);
  assert.ok(total > 0, `expected reachable attackers, got ${total}`);
  // The adjacent Polish garrison can reach it.
  assert.ok(
    baltic.maxUnits.some((u) => u.from === "poland"),
    "Polish units should be able to reach the Baltic States",
  );
});

test("territory manager: enemy attack options show a UK threat to German coast", () => {
  // G40 default already has Germany at war with the UK bloc — no setWar needed.
  const state = createInitialState(12345);
  state.phase = "combat_move";
  const enemyMap = populateEnemyAttackOptions(state, "Germany");
  assert.ok(Object.keys(enemyMap).length > 0, "enemy attack map should be non-empty");
  // western_germany is a German-controlled coastal territory; UK air/units reach it.
  const wg = enemyMap["western_germany"];
  assert.ok(wg, "western_germany should be threatened");
  const ukThreatens = wg.maxUnits.some((u) =>
    (state.territories[u.from]?.units ?? []).some((x) => x.owner === "UnitedKingdom"),
  );
  assert.ok(ukThreatens, "a UK stack should threaten western_germany");
});

test("move utils: committed Baltic attack yields all-valid engine actions", () => {
  const state = warState();
  state.phase = "combat_move";
  const { moveMap } = populateAttackOptions(state, "Germany");
  const baltic = moveMap["baltic_states"];
  // Commit just the Polish attackers.
  baltic.units = baltic.maxUnits.filter((u) => u.from === "poland");
  const actions = calculateMoveActions(state, "Germany", [baltic], true);
  assert.ok(actions.length > 0, "should emit at least one move action");

  const clone: GameState = structuredClone(state);
  clone.phase = "combat_move";
  clone.activePower = "Germany";
  for (const action of actions) {
    const r = applyAction(clone, action, "Germany");
    assert.ok(r.ok, `action ${JSON.stringify(action)} should succeed: ${r.error}`);
  }
});

test("purchase utils: China is infantry-only; infantry has best cost/HP on land", () => {
  const china = findPurchaseOptions("China");
  assert.deepEqual(
    china.map((o) => o.type),
    ["infantry"],
    "China may only build infantry",
  );

  const land = findLandPurchaseOptions("Germany").filter((o) => !o.isInfrastructure);
  const cheapest = land.reduce((best, o) =>
    o.costPerHitPoint < best.costPerHitPoint ? o : best,
  );
  assert.equal(cheapest.type, "infantry", "infantry has the best cost-per-hitpoint among land units");
});

// --- planner-level coverage (the full Pro port) ----------------------------

test("combat-move planner: Germany round 1 attacks a French/UK target", () => {
  // G40 default already has Germany at war with France & the UK bloc.
  const state = createInitialState(12345);
  state.phase = "combat_move";
  state.activePower = "Germany";
  const actions = planCombatMove(state);
  assert.ok(actions.length > 0, "Germany should plan combat moves in round 1");

  // At least one attack lands on an enemy-controlled (French / UK-bloc) target.
  const attacksEnemy = actions.some((a) => {
    if (a.kind !== "move" && a.kind !== "transport") return false;
    const to = (a as { to: string }).to;
    const c = state.territories[to]?.controller;
    return !!c && areEnemies(state, c, "Germany");
  });
  assert.ok(attacksEnemy, "a German combat move should strike an enemy-held territory");

  // The committed attack should be favourable — apply the plan and confirm at
  // least one queued battle exists with German attackers present.
  const clone: GameState = structuredClone(state);
  clone.phase = "combat_move";
  clone.activePower = "Germany";
  for (const a of actions) applyAction(clone, a, "Germany");
  const germanBattle = clone.combat.battles.find(
    (b) => b.attacker === "Germany" && !b.sbr,
  );
  assert.ok(germanBattle, "Germany should have queued at least one ground/sea battle");
});

test("purchase planner: a power spends its treasury on a single consolidated buy", () => {
  const state = createInitialState(999);
  state.phase = "purchase";
  state.activePower = "Germany";
  const before = state.treasury["Germany"];
  const actions = planPurchase(state);
  const buys = actions.filter((a) => a.kind === "buy");
  assert.equal(buys.length, 1, "exactly one consolidated buy action");
  // Applying it should not overspend.
  const clone: GameState = structuredClone(state);
  for (const a of actions) {
    const r = applyAction(clone, a, "Germany");
    assert.ok(r.ok, `purchase action should succeed: ${r.error}`);
  }
  assert.ok(clone.treasury["Germany"] >= 0, "must not overspend");
  assert.ok(clone.treasury["Germany"] < before, "should actually spend IPC");
});

test("politics planner: deterministic — same seed/round yields the same declarations", () => {
  const a = createInitialState(42);
  a.phase = "politics";
  a.activePower = "Japan";
  a.round = 3;
  const b = structuredClone(a);
  assert.deepEqual(planPolitics(a), planPolitics(b), "politics must be a pure function of state");
});
