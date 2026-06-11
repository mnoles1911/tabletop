import type { GameState } from "../types.js";
import { POWERS } from "../data/powers.js";
import { totalWarRelationships } from "./politics.js";

// ============================================================================
// Save-state migration. Old saves keep working across engine schema bumps:
//   v1 -> v2: politics (pairwise war matrix) and per-power human/AI control.
//             v1 games had every Axis power at war with every Ally and no AI,
//             so that's exactly what they migrate to.
// ============================================================================

export function migrateState(raw: unknown): GameState {
  const s = raw as GameState & { schema: number };
  if (s.schema >= 2) return s;

  s.schema = 2;
  s.relationships ??= totalWarRelationships();
  s.powerControl ??= Object.fromEntries(
    Object.values(POWERS).map((p) => [p.id, "human"]),
  ) as GameState["powerControl"];
  return s;
}
