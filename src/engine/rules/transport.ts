import type { GameState, PowerId, UnitTypeId } from "../types.js";
import { UNITS } from "../data/units.js";
import { areAllied, areEnemies } from "../data/powers.js";
import { isSea, TERRITORY_INDEX } from "../data/territories.js";
import { neighbours, addUnits, removeUnits } from "./setup.js";

// ============================================================================
// Naval transport & amphibious assault.
//
// A transport carries up to 2 land units. To keep the model simple but
// faithful, a single action moves land units from a friendly coastal territory,
// across one sea zone the player controls transports in, onto an adjacent
// coastal territory:
//   - friendly / empty destination  -> a normal sea lift (any movement phase)
//   - hostile destination           -> an amphibious assault (combat move),
//                                       queuing a battle with shore bombardment
//                                       from warships in the staging sea zone.
// Transport capacity used per sea zone is tracked for the turn so a transport
// can't ferry more than it should.
// ============================================================================

const LAND = (t: UnitTypeId) => UNITS[t].domain === "land";

export interface TransportRequest {
  from: string;
  via: string; // sea zone with the transports
  to: string;
  units: { type: UnitTypeId; count: number }[];
}

export interface TransportCheck {
  ok: boolean;
  reason?: string;
  amphibious?: boolean;
}

function freeCapacity(state: GameState, owner: PowerId, sea: string): number {
  const transports = state.territories[sea]?.units
    .filter((u) => u.owner === owner && u.type === "transport")
    .reduce((n, u) => n + u.count, 0) ?? 0;
  const used = state.transportUse[sea] ?? 0;
  return transports * (UNITS.transport.capacity ?? 2) - used;
}

export function checkTransport(state: GameState, owner: PowerId, req: TransportRequest): TransportCheck {
  const { from, via, to, units } = req;
  if (!TERRITORY_INDEX[from] || !TERRITORY_INDEX[via] || !TERRITORY_INDEX[to]) {
    return { ok: false, reason: "Unknown territory." };
  }
  if (state.activePower !== owner) return { ok: false, reason: "Not your turn." };
  if (state.phase !== "combat_move" && state.phase !== "noncombat_move") {
    return { ok: false, reason: "Transport only during a movement phase." };
  }
  if (!isSea(via)) return { ok: false, reason: "The staging zone must be a sea zone." };
  if (isSea(from) || isSea(to)) return { ok: false, reason: "Load and land on coastal land." };
  if (!neighbours(via).includes(from)) return { ok: false, reason: "Load territory isn't on that sea zone." };
  if (!neighbours(via).includes(to)) return { ok: false, reason: "Target isn't on that sea zone." };

  const total = units.reduce((n, u) => n + u.count, 0);
  if (total <= 0) return { ok: false, reason: "Select units to embark." };
  if (total > freeCapacity(state, owner, via)) {
    return { ok: false, reason: `Not enough transport capacity in ${TERRITORY_INDEX[via].display}.` };
  }

  const src = state.territories[from];
  for (const u of units) {
    if (!LAND(u.type)) return { ok: false, reason: "Only land units can be transported." };
    const have = src.units.find((s) => s.type === u.type && s.owner === owner)?.count ?? 0;
    if (have < u.count) return { ok: false, reason: "You don't have those units to load." };
  }

  const dest = state.territories[to];
  const hostile = dest.units.some((u) => areEnemies(u.owner, owner) && u.count > 0);
  const destController = dest.controller;
  if (!hostile && destController && areEnemies(destController, owner)) {
    // Empty but enemy-owned land — landing there is still an (unopposed) assault.
    return { ok: true, amphibious: state.phase === "combat_move" };
  }
  if (hostile && state.phase !== "combat_move") {
    return { ok: false, reason: "Amphibious assaults happen during combat movement." };
  }
  if (!hostile && destController && !areAllied(destController, owner)) {
    return { ok: false, reason: "Cannot land there." };
  }
  return { ok: true, amphibious: hostile && state.phase === "combat_move" };
}

export function executeTransport(state: GameState, owner: PowerId, req: TransportRequest): TransportCheck {
  const check = checkTransport(state, owner, req);
  if (!check.ok) return check;

  const src = state.territories[req.from];
  const dst = state.territories[req.to];
  const total = req.units.reduce((n, u) => n + u.count, 0);

  for (const u of req.units) {
    removeUnits(src, u.type, u.count, owner);
    addUnits(dst, u.type, u.count, owner);
  }
  state.transportUse[req.via] = (state.transportUse[req.via] ?? 0) + total;

  if (check.amphibious) {
    let battle = state.combat.battles.find((b) => b.territory === req.to);
    if (!battle) {
      battle = { territory: req.to, attacker: owner, resolved: false };
      state.combat.battles.push(battle);
    }
    battle.amphibious = true;
    battle.bombardFrom = req.via;
  }
  return check;
}
