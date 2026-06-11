import { applyAction, expectedActor } from "../engine/index.js";
import { nextAiAction, isAi } from "../engine/ai/index.js";
import type { GameRecord } from "./store.js";
import { saveGame } from "./store.js";

// ============================================================================
// AI stepper. After every human action — and on every state poll — the server
// lets AI-controlled powers play until a human is up again, the budget runs
// out (the next poll resumes), or the game ends. Bounded and re-entrant-safe.
// ============================================================================

const MAX_ACTIONS_PER_CALL = 40;
const MAX_MILLIS_PER_CALL = 750;
/** Hard cap per power-turn so a confused planner can never spin forever. */
const MAX_ACTIONS_PER_TURN = 500;

const running = new Set<string>();
const turnActionCounts = new Map<string, { key: string; n: number }>();

/** Let AI powers act. Returns true when the state changed. */
export function stepAi(game: GameRecord): boolean {
  if (!game.started || game.state.winner) return false;
  if (running.has(game.id)) return false;
  running.add(game.id);
  let changed = false;
  let failures = 0;
  try {
    const deadline = Date.now() + MAX_MILLIS_PER_CALL;
    for (let i = 0; i < MAX_ACTIONS_PER_CALL && Date.now() < deadline; i++) {
      const state = game.state;
      const actor = expectedActor(state);
      if (state.winner || !isAi(state, actor)) break;

      // Per-turn runaway guard.
      const turnKey = `${state.round}:${state.activePower}`;
      let count = turnActionCounts.get(game.id);
      if (!count || count.key !== turnKey) count = { key: turnKey, n: 0 };
      count.n += 1;
      turnActionCounts.set(game.id, count);

      const action =
        count.n > MAX_ACTIONS_PER_TURN ? { kind: "advance_phase" as const } : nextAiAction(state);
      if (!action) break;
      const result = applyAction(state, action, actor);
      if (!result.ok) {
        failures += 1;
        // Planned actions self-drop from the plan queue; battle prompts could
        // in principle fail repeatedly — break the loop rather than spin.
        if (failures >= 3) {
          applyAction(state, { kind: "advance_phase" }, actor);
          failures = 0;
        }
      } else {
        failures = 0;
      }
      state.version += 1;
      changed = true;
    }
  } finally {
    running.delete(game.id);
  }
  if (changed) saveGame(game);
  return changed;
}
