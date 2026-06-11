/*
 * Ported from TripleA (https://github.com/triplea-game/triplea)
 * games.strategy.triplea.ai.pro.AbstractProAi — © TripleA contributors.
 * Licensed under the GNU General Public License v3.0 or later.
 */
import type { GameState, PowerId } from "../../types.js";
import type { Action } from "../../rules/actions.js";

// ============================================================================
// Pro AI driver: dispatches the active phase to the phase planners (the
// TripleA Pro AI port) and answers out-of-turn battle prompts. Each planner
// returns a full ordered list of Actions for the phase; the driver in
// ../index.ts emits them one at a time.
// ============================================================================

/** Answer a battle prompt (scramble / defender casualties) for `actor`. */
export function answerBattlePrompt(state: GameState, actor: PowerId): Action | null {
  for (const b of state.combat.battles) {
    if (b.resolved) continue;
    const defender = b.defender;
    if (b.awaitingScramble && defender === actor) {
      // Pro heuristic placeholder: always scramble (TripleA ProScrambleAi).
      return { kind: "scramble", territory: b.territory };
    }
    if ((b.pendingDefenderHits ?? 0) > 0 && defender === actor) {
      return { kind: "auto_casualties", territory: b.territory, side: "defender" };
    }
    if ((b.pendingAttackerHits ?? 0) > 0 && b.attacker === actor) {
      return { kind: "auto_casualties", territory: b.territory, side: "attacker" };
    }
  }
  return null;
}

/** Plan every action the AI wants to take in the current phase, in order. */
export function planPhase(state: GameState): Action[] {
  switch (state.phase) {
    case "politics":
      return planPolitics(state);
    case "purchase":
      return planPurchase(state);
    case "combat":
      return planCombat(state);
    default:
      // tech_research / combat_move / noncombat_move / mobilize /
      // collect_income: refined by the ported planners; advance for now.
      return [];
  }
}

// --- baseline planners (replaced piecewise by the full Pro port) ------------

import { availableDeclarations } from "../../rules/politics.js";
import { PURCHASABLE, UNITS } from "../../data/units.js";

function planPolitics(state: GameState): Action[] {
  const out: Action[] = [];
  for (const target of availableDeclarations(state, state.activePower)) {
    out.push({ kind: "declare_war", target });
  }
  return out;
}

function planPurchase(state: GameState): Action[] {
  const power = state.activePower;
  let budget = state.treasury[power] ?? 0;
  const infantry = UNITS.infantry.cost;
  const n = Math.floor(budget / infantry);
  if (n <= 0 || !PURCHASABLE.includes("infantry")) return [];
  return [{ kind: "buy", units: [{ type: "infantry", count: n }] }];
}

function planCombat(state: GameState): Action[] {
  const out: Action[] = [];
  for (const b of state.combat.battles) {
    if (!b.resolved) out.push({ kind: "resolve_battle", territory: b.territory });
  }
  return out;
}
