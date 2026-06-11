/*
 * Ported from TripleA (https://github.com/triplea-game/triplea)
 * games.strategy.triplea.ai.pro.AbstractProAi — © TripleA contributors.
 * Licensed under the GNU General Public License v3.0 or later.
 */
import type { GameState, PowerId } from "../../types.js";
import type { Action } from "../../rules/actions.js";

import { planPolitics } from "./ProPoliticsAi.js";
import { planTech } from "./ProTechAi.js";
import { planPurchase, planPlace } from "./ProPurchaseAi.js";
import { planCombatMove } from "./ProCombatMoveAi.js";
import { planNonCombatMove } from "./ProNonCombatMoveAi.js";
import { shouldRetreat } from "./ProRetreatAi.js";
import { shouldScramble } from "./ProScrambleAi.js";
import { selectCasualties } from "./ProCasualtyAi.js";

// ============================================================================
// Pro AI driver: dispatches the active phase to the TripleA Pro AI port and
// answers out-of-turn battle prompts. Most planners return a full ordered list
// of Actions for the phase (the driver in ../index.ts emits them one at a time);
// the COMBAT phase is special-cased in the driver because the fight/retreat
// decision must be recomputed per battle round (see nextCombatAction below).
// ============================================================================

/** Answer a battle prompt (scramble / defender casualties) for `actor`. */
export function answerBattlePrompt(state: GameState, actor: PowerId): Action | null {
  for (const b of state.combat.battles) {
    if (b.resolved) continue;
    const defender = b.defender;

    // Scramble decision (defender, sea battles).
    if (b.awaitingScramble && defender === actor) {
      if (shouldScramble(state, b.territory, actor)) {
        return { kind: "scramble", territory: b.territory };
      }
      return { kind: "decline_scramble", territory: b.territory };
    }

    // Casualty selection — explicit chooser, falling back to auto when trivial.
    if ((b.pendingDefenderHits ?? 0) > 0 && defender === actor) {
      const explicit = selectCasualties(state, b.territory, actor, "defender");
      return explicit ?? { kind: "auto_casualties", territory: b.territory, side: "defender" };
    }
    if ((b.pendingAttackerHits ?? 0) > 0 && b.attacker === actor) {
      const explicit = selectCasualties(state, b.territory, actor, "attacker");
      return explicit ?? { kind: "auto_casualties", territory: b.territory, side: "attacker" };
    }
  }
  return null;
}

/**
 * The next action for the combat phase, computed fresh each call (NOT memoized).
 * For each unresolved battle: resolve SBRs immediately; for ground/sea battles
 * fight one round at a time, retreating (ProRetreatAi) once the fight turns
 * unfavourable. Returns null when no battle needs the active power's action
 * (the driver then advances the phase).
 */
export function nextCombatAction(state: GameState): Action | null {
  const active = state.activePower;
  for (const b of state.combat.battles) {
    if (b.resolved) continue;
    if (b.attacker !== active) continue; // defender prompts handled elsewhere

    // Strategic bombing raids resolve in one shot.
    if (b.sbr) return { kind: "resolve_battle", territory: b.territory };

    // A battle paused on a prompt is not ours to push forward here.
    if (b.awaitingScramble) return null;
    if ((b.pendingDefenderHits ?? 0) > 0 || (b.pendingAttackerHits ?? 0) > 0) {
      // Our own (attacker) pending hits are answered via answerBattlePrompt;
      // defender pending hits pause on the defender. Either way, not a round step.
      return null;
    }

    // Fight on, or retreat if the fight has turned bad (and we've fought ≥1 round
    // so the retreat is a real reassessment, not a no-op before opening fire).
    if ((b.roundsFought ?? 0) > 0 && shouldRetreat(state, b.territory, active)) {
      return { kind: "battle_retreat", territory: b.territory };
    }
    return { kind: "battle_round", territory: b.territory };
  }
  return null;
}

/** Plan every action the AI wants to take in the current (non-combat) phase. */
export function planPhase(state: GameState): Action[] {
  switch (state.phase) {
    case "politics":
      return planPolitics(state);
    case "tech_research":
      return planTech(state);
    case "purchase":
      return planPurchase(state);
    case "combat_move":
      return planCombatMove(state);
    case "noncombat_move":
      return planNonCombatMove(state);
    case "mobilize":
      return planPlace(state);
    case "combat":
      // Combat is driven action-by-action by nextCombatAction in ../index.ts.
      return [];
    case "collect_income":
    default:
      return [];
  }
}
