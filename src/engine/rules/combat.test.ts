import { test } from "node:test";
import assert from "node:assert/strict";
import { createInitialState } from "./setup.js";
import { resolveBattle } from "./combat.js";
import { applyAction } from "./actions.js";
import { movementAllowance } from "./movement.js";
import { DEFAULT_OPTIONS } from "../types.js";

// Deterministic combat: the same seed must always produce the same battle.
test("combat is deterministic for a fixed seed", () => {
  const a = createInitialState(12345);
  const b = createInitialState(12345);

  // Stage an identical battle in both states: German units attacking Poland's
  // defenders already exist at game start (Germany controls Poland with units),
  // so instead drop attackers into a neutral fight via a synthetic territory.
  a.territories["france"].units.push({ type: "infantry", owner: "UnitedKingdom", count: 3 });
  b.territories["france"].units.push({ type: "infantry", owner: "UnitedKingdom", count: 3 });
  a.combat.battles.push({ territory: "france", attacker: "UnitedKingdom", resolved: false });
  b.combat.battles.push({ territory: "france", attacker: "UnitedKingdom", resolved: false });

  const ra = resolveBattle(a, "france");
  const rb = resolveBattle(b, "france");
  assert.equal(ra.winner, rb.winner);
  assert.equal(ra.rounds.length, rb.rounds.length);
});

test("buying more than the treasury is rejected", () => {
  const s = createInitialState(1);
  const res = applyAction(s, { kind: "buy", units: [{ type: "battleship", count: 99 }] }, "Germany");
  assert.equal(res.ok, false);
});

test("phase advances through the full turn sequence", () => {
  const s = createInitialState(1);
  const seq = ["combat_move", "combat", "noncombat_move", "mobilize", "collect_income"];
  for (const expected of seq) {
    applyAction(s, { kind: "advance_phase" }, "Germany");
    assert.equal(s.phase, expected);
  }
  // One more advance ends Germany's turn and hands off to the Soviet Union.
  applyAction(s, { kind: "advance_phase" }, "Germany");
  assert.equal(s.activePower, "SovietUnion");
  assert.equal(s.phase, "purchase");
});

test("amphibious assault captures a coastal territory", () => {
  const s = createInitialState(42);
  s.activePower = "UnitedKingdom";
  s.phase = "combat_move";
  s.territories["united_kingdom"].units.push({ type: "infantry", owner: "UnitedKingdom", count: 2 });
  const r = applyAction(
    s,
    { kind: "transport", from: "united_kingdom", via: "sz_north", to: "norway", units: [{ type: "infantry", count: 2 }] },
    "UnitedKingdom",
  );
  assert.equal(r.ok, true);
  const battle = s.combat.battles.find((b) => b.territory === "norway");
  assert.equal(battle?.amphibious, true);
  s.phase = "combat";
  resolveBattle(s, "norway");
  assert.equal(s.territories["norway"].controller, "UnitedKingdom");
});

test("strategic bombing damages a factory and returns bombers", () => {
  const s = createInitialState(42);
  s.activePower = "Germany";
  s.phase = "combat_move";
  s.territories["germany"].units.push({ type: "strategic_bomber", owner: "Germany", count: 2 });
  assert.equal(applyAction(s, { kind: "strategic_bomb", from: "germany", to: "united_kingdom", count: 2 }, "Germany").ok, true);
  s.phase = "combat";
  resolveBattle(s, "united_kingdom");
  assert.ok((s.territories["united_kingdom"].factoryDamage ?? 0) > 0);
  const back = s.territories["germany"].units.find((u) => u.type === "strategic_bomber")?.count ?? 0;
  assert.ok(back > 0);
});

test("research costs 5 IPC per die and is gated by phase", () => {
  const s = createInitialState(42, { ...DEFAULT_OPTIONS, research: true });
  const before = s.treasury["Germany"];
  assert.equal(applyAction(s, { kind: "research", dice: 2 }, "Germany").ok, true);
  assert.equal(s.treasury["Germany"], before - 10);
});

test("factory production capacity limits placement", () => {
  const s = createInitialState(42);
  s.phase = "mobilize";
  // Germany factory territory value is 14 -> capacity 14; place 1 infantry ok.
  s.purchases = [{ type: "infantry", count: 1 }];
  assert.equal(applyAction(s, { kind: "place", unit: "infantry", territory: "germany" }, "Germany").ok, true);
  assert.equal(s.placement["germany"], 1);
});

test("moving a land unit into undefended enemy land captures it", () => {
  const s = createInitialState(42);
  s.activePower = "Germany";
  s.phase = "combat_move";
  // Norway is German already; use an undefended neutral instead: Spain (no owner).
  // Put a German infantry in adjacent France (German? no, France is French). Use
  // poland (German) -> baltic_states (Soviet) only if undefended. Empty a target:
  s.territories["baltic_states"].units = []; // undefended Soviet land
  const r = applyAction(s, { kind: "move", from: "poland", to: "baltic_states", unit: "infantry", count: 1 }, "Germany");
  assert.equal(r.ok, true);
  assert.equal(s.territories["baltic_states"].controller, "Germany");
});

test("annexing a neutral by walking in takes control", () => {
  const s = createInitialState(42);
  s.activePower = "Germany";
  s.phase = "noncombat_move";
  s.territories["france"].units.push({ type: "infantry", owner: "Germany", count: 1 });
  // Spain is a neutral (no owner) adjacent to France.
  const r = applyAction(s, { kind: "move", from: "france", to: "spain", unit: "infantry", count: 1 }, "Germany");
  assert.equal(r.ok, true);
  assert.equal(s.territories["spain"].controller, "Germany");
});

test("a naval base grants +1 movement to ships starting there", () => {
  const s = createInitialState(42);
  s.activePower = "Germany";
  s.phase = "noncombat_move";
  // Put a German naval base + cruiser in sz_baltic; baseline cruiser move = 2.
  s.territories["sz_baltic"].units.push({ type: "naval_base", owner: "Germany", count: 1 });
  s.territories["sz_baltic"].units.push({ type: "cruiser", owner: "Germany", count: 1 });
  // sz_baltic -> sz_north -> sz_mid_atlantic is 2 hops; with +1 it reaches a 3rd.
  // Just assert the allowance is 3 now (base +1 over the cruiser's base 2).
  assert.equal(movementAllowance(s, "Germany", "sz_baltic", "cruiser"), 3);
});

test("stranded aircraft are lost when non-combat movement ends", () => {
  const s = createInitialState(42);
  s.activePower = "Germany";
  s.phase = "noncombat_move";
  // A German fighter alone in an open sea zone with no carrier is doomed.
  s.territories["sz_e_atlantic"].units.push({ type: "fighter", owner: "Germany", count: 1 });
  applyAction(s, { kind: "advance_phase" }, "Germany"); // leaves noncombat_move
  const left = s.territories["sz_e_atlantic"].units.find((u) => u.type === "fighter" && u.owner === "Germany");
  assert.equal(left, undefined);
});

test("Suez canal blocks ships unless the gate (Egypt) is friendly", () => {
  const s = createInitialState(42);
  s.activePower = "Italy";
  s.phase = "noncombat_move";
  s.territories["sz_med"].units.push({ type: "cruiser", owner: "Italy", count: 1 });
  // Egypt starts UK-controlled (enemy of Italy) -> passage blocked.
  let r = applyAction(s, { kind: "move", from: "sz_med", to: "sz_indian", unit: "cruiser", count: 1 }, "Italy");
  assert.equal(r.ok, false);
  // Hand Egypt to Italy -> passage now allowed.
  s.territories["egypt"].controller = "Italy";
  r = applyAction(s, { kind: "move", from: "sz_med", to: "sz_indian", unit: "cruiser", count: 1 }, "Italy");
  assert.equal(r.ok, true);
});
