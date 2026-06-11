import { test } from "node:test";
import assert from "node:assert/strict";
import { createInitialState } from "../rules/setup.js";
import { applyAction, expectedActor } from "../rules/actions.js";
import { TURN_ORDER } from "../data/powers.js";
import type { GameState } from "../types.js";
import { nextAiAction, isAi, resetAiCache } from "./index.js";

// Drive a complete all-AI game for a few rounds: it must keep making legal
// progress without throwing, and be perfectly deterministic for a fixed seed.

function allAiState(seed: number): GameState {
  const s = createInitialState(seed);
  for (const p of TURN_ORDER) s.powerControl[p] = "ai";
  return s;
}

function playRounds(state: GameState, rounds: number): void {
  let guard = 0;
  while (state.round <= rounds && !state.winner && guard++ < 5000) {
    const actor = expectedActor(state);
    assert.ok(isAi(state, actor), "an all-AI game never waits on a human");
    const action = nextAiAction(state);
    assert.ok(action, "the AI always has a next action");
    applyAction(state, action!, actor);
    state.version += 1;
  }
  assert.ok(guard < 5000, "the AI game must not need an unbounded number of actions");
}

test("an all-AI game plays multiple rounds to completion deterministically", () => {
  resetAiCache();
  const a = allAiState(777);
  playRounds(a, 3);

  resetAiCache();
  const b = allAiState(777);
  playRounds(b, 3);

  assert.ok(a.round > 3 || a.winner, "the game advanced through 3 full rounds");
  assert.equal(JSON.stringify(a), JSON.stringify(b), "identical seeds replay identically");
});
