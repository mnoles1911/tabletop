import { test } from "node:test";
import assert from "node:assert/strict";
import { createInitialState } from "./setup.js";
import { applyAction } from "./actions.js";
import { TURN_ORDER } from "../data/powers.js";
import { DEFAULT_OPTIONS } from "../types.js";

// Drive several complete turns through the public action API the way the server
// does, exercising every phase. The goal is integration coverage: the whole
// loop runs to completion without throwing and hands off between powers cleanly.
test("a full round of turns runs end-to-end without errors", () => {
  const s = createInitialState(2024, { ...DEFAULT_OPTIONS, research: true, lowLuck: true });

  const playTurn = () => {
    const power = s.activePower;
    // Purchase: buy a couple of infantry if affordable.
    applyAction(s, { kind: "buy", units: [{ type: "infantry", count: 1 }] }, power);
    applyAction(s, { kind: "advance_phase" }, power); // -> combat_move
    applyAction(s, { kind: "advance_phase" }, power); // -> combat
    // Auto-resolve any battles that materialised.
    for (const b of [...s.combat.battles]) {
      if (!b.resolved) applyAction(s, { kind: "resolve_battle", territory: b.territory }, power);
    }
    applyAction(s, { kind: "advance_phase" }, power); // -> noncombat_move
    applyAction(s, { kind: "advance_phase" }, power); // -> mobilize
    // Place a bought infantry at the capital if there's a factory there.
    if (s.purchases.length) {
      const cap = s.territories[require_capital(power)];
      if (cap) applyAction(s, { kind: "place", unit: "infantry", territory: cap.id }, power);
    }
    applyAction(s, { kind: "advance_phase" }, power); // -> collect_income
    applyAction(s, { kind: "advance_phase" }, power); // end turn -> next power
  };

  const startRound = s.round;
  for (let i = 0; i < TURN_ORDER.length; i++) playTurn();

  // After everyone has played once, we should be back near the top of the order
  // in a later round, with the game intact.
  assert.ok(s.round >= startRound);
  assert.ok(Object.keys(s.treasury).length === TURN_ORDER.length);
  assert.equal(s.phase, "purchase");
});

function require_capital(power: string): string {
  const caps: Record<string, string> = {
    Germany: "germany",
    SovietUnion: "russia",
    Japan: "japan",
    UnitedStates: "eastern_usa",
    China: "szechwan",
    UnitedKingdom: "united_kingdom",
    Italy: "italy",
    Australia: "new_south_wales",
    France: "france",
  };
  return caps[power];
}
