/*
 * Ported from TripleA (https://github.com/triplea-game/triplea)
 * games.strategy.triplea.ai.pro.AbstractProAi.selectCasualties essentials —
 * © TripleA contributors. Licensed under the GNU General Public License v3.0
 * or later.
 *
 * Casualty chooser. TripleA orders losses cheapest-first by combat value,
 * keeping high-value combat power (and two-hit ships' second hit) as long as
 * possible. We pick losses by ascending (cost, then the relevant attack/defense
 * stat); when the attacker is taking the territory we try to keep at least one
 * land unit so the conquest sticks. Returns an assign_casualties Action, or null
 * to fall back to the engine's safe auto-resolution.
 */
import type { GameState, PowerId, UnitTypeId } from "../../types.js";
import type { Action } from "../../rules/actions.js";
import type { BattleSide } from "../../rules/combat.js";
import { UNITS } from "../../data/units.js";
import { areEnemies } from "../../rules/politics.js";
import { isSea } from "../../data/territories.js";

const isInfra = (type: UnitTypeId): boolean =>
  UNITS[type].domain === "structure" || type === "aa_gun";

interface SideUnit {
  type: UnitTypeId;
  count: number;
}

/** Units of `side` currently in the battle territory, as type/count groups. */
function sideUnits(
  state: GameState,
  territory: string,
  attacker: PowerId,
  side: BattleSide,
): SideUnit[] {
  const groups = new Map<UnitTypeId, number>();
  for (const u of state.territories[territory]?.units ?? []) {
    if (u.count <= 0) continue;
    const isAttacker = u.owner === attacker;
    const isDefender = areEnemies(state, u.owner, attacker);
    if ((side === "attacker" && isAttacker) || (side === "defender" && isDefender)) {
      groups.set(u.type, (groups.get(u.type) ?? 0) + u.count);
    }
  }
  return [...groups.entries()].map(([type, count]) => ({ type, count }));
}

/**
 * selectCasualties — choose which units of `side` absorb `hits`, cheapest combat
 * value first. Keeps one land unit for the attacker on land when possible so a
 * win still captures the territory. Returns null when the trivial/auto path is
 * just as good (single fighting type, or everything dies) so the caller can use
 * auto_casualties.
 */
export function selectCasualties(
  state: GameState,
  territory: string,
  actor: PowerId,
  side: BattleSide,
): Action | null {
  const battle = state.combat.battles.find((b) => b.territory === territory);
  if (!battle) return null;
  const attacker = battle.attacker;
  const hits = side === "attacker" ? battle.pendingAttackerHits ?? 0 : battle.pendingDefenderHits ?? 0;
  if (hits <= 0) return null;

  const units = sideUnits(state, territory, attacker, side).filter((u) => !isInfra(u.type));
  if (units.length === 0) return null;

  const distinctTypes = units.length;
  const totalHp = units.reduce((n, u) => n + UNITS[u.type].hits * u.count, 0);
  // Trivial: a single fighting type or a wipeout — the engine auto-resolves these
  // identically, so don't bother emitting an explicit list.
  if (distinctTypes <= 1 || hits >= totalHp) return null;

  // Value key: cheapest first; for the side's relevant role use attack (attacker)
  // or defense (defender) as the tiebreak so we keep our hardest hitters.
  const stat = (t: UnitTypeId): number => (side === "attacker" ? UNITS[t].attack : UNITS[t].defense);
  const ordered = [...units].sort(
    (a, b) => UNITS[a.type].cost - UNITS[b.type].cost || stat(a.type) - stat(b.type),
  );

  // For an attacker on land, reserve one land unit (so a win captures the land).
  const keepLand = side === "attacker" && !isSea(territory);
  const landTypes = new Set(ordered.filter((u) => UNITS[u.type].domain === "land").map((u) => u.type));
  const totalLand = ordered
    .filter((u) => UNITS[u.type].domain === "land")
    .reduce((n, u) => n + u.count, 0);

  const losses = new Map<UnitTypeId, number>();
  let remaining = hits;
  let landLost = 0;
  for (const u of ordered) {
    if (remaining <= 0) break;
    let avail = u.count;
    const isLand = UNITS[u.type].domain === "land";
    if (keepLand && isLand && landTypes.size > 0) {
      // Don't let the last land unit die to this assignment.
      const wouldLeave = totalLand - (landLost + avail);
      if (wouldLeave < 1) avail = Math.max(0, totalLand - landLost - 1);
    }
    // Each loss consumes one hit per hit point; assign at unit granularity
    // (the engine removes full units of the chosen type).
    const take = Math.min(avail, remaining);
    if (take <= 0) continue;
    losses.set(u.type, (losses.get(u.type) ?? 0) + take);
    remaining -= take;
    if (isLand) landLost += take;
  }

  // If we couldn't allocate all hits while preserving a land unit, give up the
  // reservation and fall back to auto (safe).
  if (remaining > 0) return null;

  const lossList = [...losses.entries()]
    .filter(([, count]) => count > 0)
    .map(([type, count]) => ({ type, count }));
  const total = lossList.reduce((n, l) => n + l.count, 0);
  if (total !== hits) return null; // mismatch — let auto handle it

  return { kind: "assign_casualties", territory, losses: lossList, side };
}
