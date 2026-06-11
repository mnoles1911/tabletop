import { test } from "node:test";
import assert from "node:assert/strict";
import { createInitialState } from "./setup.js";
import { applyAction } from "./actions.js";
import { atWar, availableDeclarations } from "./politics.js";

test("the G40 opening relationships are set up correctly", () => {
  const s = createInitialState(1);
  // Germany & Italy fight the UK bloc; Japan fights China.
  for (const axis of ["Germany", "Italy"] as const) {
    for (const ally of ["UnitedKingdom", "Australia", "France"] as const) {
      assert.equal(atWar(s, axis, ally), true, `${axis} vs ${ally}`);
    }
  }
  assert.equal(atWar(s, "Japan", "China"), true);
  // Everyone else starts at peace.
  assert.equal(atWar(s, "Germany", "SovietUnion"), false);
  assert.equal(atWar(s, "Germany", "UnitedStates"), false);
  assert.equal(atWar(s, "Japan", "UnitedKingdom"), false);
  assert.equal(atWar(s, "Japan", "UnitedStates"), false);
  // Same-alliance powers are never at war; the Neutral garrison resists all.
  assert.equal(atWar(s, "Germany", "Italy"), false);
  assert.equal(atWar(s, "Germany", "Neutral"), true);
});

test("declaring war on a UK-bloc member brings the whole bloc", () => {
  const s = createInitialState(1);
  s.activePower = "Japan";
  s.phase = "politics";
  const r = applyAction(s, { kind: "declare_war", target: "UnitedKingdom" }, "Japan");
  assert.equal(r.ok, true);
  assert.equal(atWar(s, "Japan", "UnitedKingdom"), true);
  assert.equal(atWar(s, "Japan", "Australia"), true);
  assert.equal(atWar(s, "Japan", "France"), true);
  assert.equal(atWar(s, "Japan", "UnitedStates"), false);
});

test("the United States cannot declare war before round 4", () => {
  const s = createInitialState(1);
  s.activePower = "UnitedStates";
  s.phase = "politics";
  assert.deepEqual(availableDeclarations(s, "UnitedStates"), []);
  assert.equal(applyAction(s, { kind: "declare_war", target: "Germany" }, "UnitedStates").ok, false);
  s.round = 4;
  assert.ok(availableDeclarations(s, "UnitedStates").includes("Germany"));
  assert.equal(applyAction(s, { kind: "declare_war", target: "Germany" }, "UnitedStates").ok, true);
  assert.equal(atWar(s, "UnitedStates", "Germany"), true);
});

test("the Axis may bring the USA in early by declaring war on it", () => {
  const s = createInitialState(1);
  s.activePower = "Japan";
  s.phase = "politics";
  assert.equal(applyAction(s, { kind: "declare_war", target: "UnitedStates" }, "Japan").ok, true);
  assert.equal(atWar(s, "Japan", "UnitedStates"), true);
});

test("borders are closed to powers at peace until war is declared", () => {
  const s = createInitialState(1);
  s.activePower = "Germany";
  s.phase = "combat_move";
  s.territories["poland"].units.push({ type: "infantry", owner: "Germany", count: 3 });
  // Germany and the USSR start at peace: the Soviet border is closed.
  const blocked = applyAction(s, { kind: "move", from: "poland", to: "baltic_states", unit: "infantry", count: 1 }, "Germany");
  assert.equal(blocked.ok, false);
  assert.match(blocked.error ?? "", /not at war/);
  // Declare war (politics), then the same move is a legal combat move.
  s.phase = "politics";
  assert.equal(applyAction(s, { kind: "declare_war", target: "SovietUnion" }, "Germany").ok, true);
  s.phase = "combat_move";
  const open = applyAction(s, { kind: "move", from: "poland", to: "baltic_states", unit: "infantry", count: 1 }, "Germany");
  assert.equal(open.ok, true);
});

test("declarations only happen in the politics phase", () => {
  const s = createInitialState(1);
  s.activePower = "Germany";
  s.phase = "purchase";
  assert.equal(applyAction(s, { kind: "declare_war", target: "SovietUnion" }, "Germany").ok, false);
});
