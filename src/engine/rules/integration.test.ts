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

  // Phase-aware turn driver: act in each phase as it comes up (phases with
  // nothing to do — politics, tech_research, combat — may be auto-skipped).
  const playTurn = () => {
    const power = s.activePower;
    let guard = 0;
    while (s.activePower === power && !s.winner && guard++ < 30) {
      if (s.phase === "purchase") {
        applyAction(s, { kind: "buy", units: [{ type: "infantry", count: 1 }] }, power);
      }
      if (s.phase === "combat") {
        for (const b of [...s.combat.battles]) {
          if (!b.resolved) applyAction(s, { kind: "resolve_battle", territory: b.territory }, power);
        }
      }
      if (s.phase === "mobilize" && s.purchases.length) {
        const cap = s.territories[require_capital(power)];
        if (cap) applyAction(s, { kind: "place", unit: "infantry", territory: cap.id }, power);
      }
      applyAction(s, { kind: "advance_phase" }, power);
    }
  };

  const startRound = s.round;
  for (let i = 0; i < TURN_ORDER.length; i++) playTurn();

  // After everyone has played once, we should be back near the top of the order
  // in a later round, with the game intact. Germany still has declarations
  // available, so round 2 opens in its politics phase.
  assert.ok(s.round >= startRound);
  assert.ok(Object.keys(s.treasury).length === TURN_ORDER.length);
  assert.equal(s.phase, "politics");
});

function require_capital(power: string): string {
  const caps: Record<string, string> = {
    Germany: "germany",
    SovietUnion: "russia",
    Japan: "japan",
    UnitedStates: "eastern_united_states",
    China: "szechwan",
    UnitedKingdom: "united_kingdom",
    Italy: "southern_italy",
    Australia: "new_south_wales",
    France: "france",
  };
  return caps[power];
}
