/*
 * Ported from TripleA (https://github.com/triplea-game/triplea)
 * games.strategy.triplea.ai.pro.util.ProMoveUtils — © TripleA contributors.
 * Licensed under the GNU General Public License v3.0 or later.
 *
 * calculateMoveActions: turns committed ProTerritory plans into engine Actions.
 * Java's doMove executes calculateMoveRoutes / calculateAmphibRoutes /
 * calculateBombardMoveRoutes in a safe order so naval screens and transports are
 * in place before the units that depend on them; we reproduce that order —
 * naval first, then transports/amphibious, then land, then air — and validate
 * every emitted action against a progressively-updated CLONE (applying each
 * action so later checks see earlier moves). Actions that fail validation on the
 * clone are dropped, exactly as Java skips routes getRouteForUnit can't satisfy.
 */
import type { GameState, PowerId, UnitTypeId } from "../../types.js";
import { UNITS } from "../../data/units.js";
import type { Action } from "../../rules/actions.js";
import { applyAction } from "../../rules/actions.js";
import { isSea } from "../../data/territories.js";
import type { ProTerritory } from "./ProTerritory.js";

// ============================================================================
// ProMoveUtils — committed plans → ordered, validated Action[].
// ============================================================================

const domainRank = (type: UnitTypeId): number => {
  switch (UNITS[type].domain) {
    case "sea":
      return 0; // naval screen first
    case "land":
      return 2; // land after transports/amphibious
    case "air":
      return 3; // air last (so it can follow its carriers / cover)
    default:
      return 4;
  }
};

/**
 * calculateMoveActions — flatten the committed units of `plans` into a safely
 * ordered, validated Action[]. `combat` selects the movement phase the actions
 * are validated under (combat_move emits attacks/amphibious; noncombat_move
 * emits reinforcement). Each action is applied to a working clone so later
 * validations account for earlier moves; any that fail are skipped.
 */
export function calculateMoveActions(
  state: GameState,
  power: PowerId,
  plans: ProTerritory[],
  combat: boolean,
): Action[] {
  // 1) Build the candidate action list in Java's batching order.
  const naval: Action[] = [];
  const amphibious: Action[] = [];
  const land: Action[] = [];
  const air: Action[] = [];

  for (const pt of plans) {
    // Amphibious assaults (transports + troops) — second batch.
    for (const a of pt.amphibUnits) {
      amphibious.push({
        kind: "transport",
        from: a.from,
        via: a.via,
        to: pt.territoryId,
        units: a.units.map((u) => ({ type: u.type, count: u.count })),
      });
    }
    // Plain moves, bucketed by domain.
    for (const u of pt.units) {
      const action: Action = {
        kind: "move",
        from: u.from,
        to: pt.territoryId,
        unit: u.type,
        count: u.count,
      };
      const bucket = domainRank(u.type);
      if (bucket === 0) naval.push(action);
      else if (bucket === 3) air.push(action);
      else land.push(action);
    }
  }

  const ordered = [...naval, ...amphibious, ...land, ...air];

  // 2) Validate against a progressively-updated clone, dropping failures.
  const clone = structuredClone(state);
  clone.phase = combat ? "combat_move" : "noncombat_move";
  clone.activePower = power;

  const accepted: Action[] = [];
  for (const action of ordered) {
    const res = applyAction(clone, action, power);
    if (res.ok) accepted.push(action);
  }
  return accepted;
}

/** Convenience: are any of these committed plans amphibious (for ordering tests). */
export function hasAmphibious(plans: ProTerritory[]): boolean {
  return plans.some((p) => p.amphibUnits.length > 0);
}

/** Convenience: is a territory a sea target (move-utils callers occasionally need it). */
export const isSeaTarget = (id: string): boolean => isSea(id);
