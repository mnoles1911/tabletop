/*
 * Ported from TripleA (https://github.com/triplea-game/triplea)
 * games.strategy.triplea.ai.pro.ProTechAi — © TripleA contributors.
 * Licensed under the GNU General Public License v3.0 or later.
 *
 * Slim tech port. Java only researches when comfortably ahead on IPC (it won't
 * starve unit production for a dice gamble). We spend a small, bounded number of
 * research dice (5 IPC each) when the treasury is well above what the power
 * needs for a solid unit buy, leaving the bulk for purchases.
 */
import type { GameState } from "../../types.js";
import type { Action } from "../../rules/actions.js";
import { RESEARCH_DIE_COST } from "../../rules/research.js";

/** Treasury below which we never gamble on research (keep buying units). */
const RICH_THRESHOLD = 40;
/** Most dice we'll ever buy in one phase. */
const MAX_DICE = 3;

/** Plan the tech_research phase: buy spare-IPC research dice when rich. */
export function planTech(state: GameState): Action[] {
  if (!state.options.research) return [];
  const power = state.activePower;
  const ipc = state.treasury[power] ?? 0;
  if (ipc < RICH_THRESHOLD) return [];

  // Spend the surplus above the threshold, capped at MAX_DICE dice.
  const surplus = ipc - RICH_THRESHOLD;
  const dice = Math.min(MAX_DICE, Math.floor(surplus / RESEARCH_DIE_COST));
  if (dice <= 0) return [];
  return [{ kind: "research", dice }];
}
