import type { GameState, PowerId } from "../types.js";
import type { Action } from "../rules/actions.js";
import { expectedActor } from "../rules/actions.js";
import { planPhase, answerBattlePrompt, nextCombatAction } from "./pro/ProAi.js";

// ============================================================================
// AI driver. `nextAiAction(state)` returns the single next Action the power
// the game is waiting on (expectedActor) wants to take, or null when that
// power is not AI-controlled. The server (or the local backend) applies the
// action through applyAction and calls again, looping until a human is up.
//
// Determinism: planners read only the GameState; any randomness they need
// flows through actions that roll on state.rng. Phase plans are memoized per
// (seed, round, power, phase) so a plan is computed once when the phase is
// entered and then emitted one action at a time; an action the engine rejects
// is simply dropped (the next call returns the following one), and an empty
// plan advances the phase.
// ============================================================================

const planCache = new Map<string, Action[]>();

/** Drop memoized phase plans (tests / replays that re-run the same seed). */
export function resetAiCache(): void {
  planCache.clear();
}

function cacheKey(state: GameState): string {
  return `${state.rng.seed}:${state.round}:${state.activePower}:${state.phase}`;
}

export function isAi(state: GameState, power: PowerId): boolean {
  return state.powerControl?.[power] === "ai";
}

/** The next action of the AI power the game is waiting on (null if human/over). */
export function nextAiAction(state: GameState): Action | null {
  if (state.winner) return null;
  const actor = expectedActor(state);
  if (!isAi(state, actor)) return null;

  // Out-of-turn battle prompts (defender casualties / scramble) bypass plans.
  if (actor !== state.activePower || state.phase === "combat") {
    const prompt = answerBattlePrompt(state, actor);
    if (prompt) return prompt;
    if (actor !== state.activePower) return null; // nothing to answer
  }

  // Combat is NOT memoized: the fight/retreat decision must be recomputed per
  // battle round (plans consumed action-by-action would advance the phase while
  // battles remained unresolved). Compute the next combat action directly; when
  // none remains, advance the phase. Determinism holds — it's a pure function of
  // the current state.
  if (state.phase === "combat") {
    return nextCombatAction(state) ?? { kind: "advance_phase" };
  }

  const key = cacheKey(state);
  let queue = planCache.get(key);
  if (!queue) {
    queue = planPhase(state);
    if (planCache.size > 64) planCache.clear();
    planCache.set(key, queue);
  }
  const action = queue.shift();
  return action ?? { kind: "advance_phase" };
}
