import type { GameState, PowerId, UnitTypeId } from "../types.js";
import { UNITS, hasFlag } from "../data/units.js";
import { areAllied, areEnemies } from "../data/powers.js";
import { TERRITORY_INDEX, isSea, canalGate } from "../data/territories.js";
import { neighbours, addUnits, removeUnits } from "./setup.js";
import { captureTerritory } from "./control.js";

// ============================================================================
// Movement system. Validates and executes a move of a homogeneous group of
// units from one territory to another:
//   - land units travel the land graph, sea units the sea graph, air over both
//   - movement-point budget enforced via shortest path on the legal subgraph
//   - intermediate territories must be passable (no enemy units = zone of
//     control); the destination may hold enemies only during combat move,
//     which queues a battle for the combat phase
//   - air/naval bases in the starting territory grant +1 movement
// ============================================================================

const def = (t: UnitTypeId) => UNITS[t];

/**
 * Effective movement allowance: a unit starting in a territory with a friendly
 * air base (air units) or naval base (sea units) gains +1 movement.
 */
export function movementAllowance(state: GameState, owner: PowerId, from: string, type: UnitTypeId): number {
  let move = def(type).movement;
  const here = state.territories[from];
  const friendlyBase = (flag: string) =>
    here?.units.some((u) => hasFlag(u.type, flag) && (u.owner === owner || areAllied(u.owner, owner)));
  if (def(type).domain === "air" && friendlyBase("air_base")) move += 1;
  if (def(type).domain === "sea" && friendlyBase("naval_base")) move += 1;
  return move;
}

export interface MoveRequest {
  from: string;
  to: string;
  type: UnitTypeId;
  count: number;
}

export interface MoveCheck {
  ok: boolean;
  reason?: string;
  /** True when the move enters enemy territory and starts a battle. */
  initiatesCombat?: boolean;
}

/** Is a node legal to *pass through* for this unit's domain & owner? */
function passableIntermediate(
  state: GameState,
  node: string,
  type: UnitTypeId,
  owner: PowerId,
): boolean {
  const d = def(type);
  if (d.domain === "air") return true; // aircraft overfly anything
  if (d.domain === "land" && isSea(node)) return false;
  if (d.domain === "sea" && !isSea(node)) return false;
  // Cannot pass through a territory containing enemy units (zone of control).
  const ts = state.territories[node];
  return !ts.units.some((u) => areEnemies(u.owner, owner) && u.count > 0);
}

/** Is `to` a legal *destination* node for this unit's domain? */
function validDestinationDomain(type: UnitTypeId, to: string): boolean {
  const d = def(type);
  if (d.domain === "air") return true;
  if (d.domain === "land") return !isSea(to);
  return isSea(to); // sea units
}

/** Shortest hop-count from `from` to `to` over the legal subgraph, or Infinity. */
function shortestPath(
  state: GameState,
  from: string,
  to: string,
  type: UnitTypeId,
  owner: PowerId,
): number {
  if (from === to) return 0;
  const seen = new Set<string>([from]);
  let frontier: Array<{ node: string; dist: number }> = [{ node: from, dist: 0 }];
  while (frontier.length) {
    const next: typeof frontier = [];
    for (const { node, dist } of frontier) {
      for (const n of neighbours(node)) {
        if (seen.has(n)) continue;
        // Canals only let through ships of a power friendly with the gate's owner.
        if (def(type).domain === "sea") {
          const gate = canalGate(node, n);
          if (gate) {
            const gc = state.territories[gate].controller;
            if (!gc || (gc !== owner && !areAllied(gc, owner))) continue;
          }
        }
        seen.add(n);
        if (n === to) return dist + 1;
        // Only continue the search through passable intermediates.
        if (passableIntermediate(state, n, type, owner)) {
          next.push({ node: n, dist: dist + 1 });
        }
      }
    }
    frontier = next;
  }
  return Infinity;
}

export function checkMove(state: GameState, owner: PowerId, req: MoveRequest): MoveCheck {
  const { from, to, type, count } = req;
  if (!TERRITORY_INDEX[from] || !TERRITORY_INDEX[to]) return { ok: false, reason: "Unknown territory." };
  if (count <= 0) return { ok: false, reason: "Nothing selected to move." };
  if (state.activePower !== owner) return { ok: false, reason: "Not your turn." };
  if (state.phase !== "combat_move" && state.phase !== "noncombat_move") {
    return { ok: false, reason: "Units can only move during a movement phase." };
  }

  const src = state.territories[from];
  const stack = src.units.find((u) => u.type === type && u.owner === owner);
  if (!stack || stack.count < count) return { ok: false, reason: "You don't have those units there." };
  if (def(type).immobileInCombatMove) return { ok: false, reason: "That unit cannot move." };

  if (!validDestinationDomain(type, to)) {
    return { ok: false, reason: `${def(type).display} cannot end its move in ${TERRITORY_INDEX[to].display}.` };
  }

  const dist = shortestPath(state, from, to, type, owner);
  if (dist === Infinity) return { ok: false, reason: "No legal path (blocked by enemy units or terrain)." };
  const allowance = movementAllowance(state, owner, from, type);
  if (dist > allowance) {
    return { ok: false, reason: `Out of range (needs ${dist}, has ${allowance}).` };
  }

  const destEnemies = state.territories[to].units.some((u) => areEnemies(u.owner, owner) && u.count > 0);
  if (destEnemies && state.phase === "noncombat_move") {
    return { ok: false, reason: "Cannot move into enemy territory during non-combat movement." };
  }

  return { ok: true, initiatesCombat: destEnemies && state.phase === "combat_move" };
}

export function executeMove(state: GameState, owner: PowerId, req: MoveRequest): MoveCheck {
  const check = checkMove(state, owner, req);
  if (!check.ok) return check;

  const src = state.territories[req.from];
  const dst = state.territories[req.to];
  removeUnits(src, req.type, req.count, owner);
  addUnits(dst, req.type, req.count, owner);

  // Moving into enemy territory queues (or joins) a battle for the combat phase.
  if (check.initiatesCombat) {
    const existing = state.combat.battles.find((b) => b.territory === req.to);
    if (!existing) {
      state.combat.battles.push({ territory: req.to, attacker: owner, resolved: false });
    }
  } else if (UNITS[req.type].domain === "land" && !isSea(req.to)) {
    // A land unit ending its move on undefended land that isn't already ours
    // (or an ally's) takes control: capturing empty enemy land, liberating an
    // ally's, or annexing a neutral.
    const controller = dst.controller;
    const hasEnemies = dst.units.some((u) => areEnemies(u.owner, owner));
    if (!hasEnemies && (!controller || (controller !== owner && !areAllied(controller, owner)))) {
      captureTerritory(state, dst, owner, []);
    }
  }
  return check;
}
