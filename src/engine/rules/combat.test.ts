import { test } from "node:test";
import assert from "node:assert/strict";
import { createInitialState } from "./setup.js";
import { resolveBattle } from "./combat.js";
import { applyAction } from "./actions.js";

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
