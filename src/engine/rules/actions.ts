import type { GameState, PowerId, UnitTypeId } from "../types.js";
import { UNITS, PURCHASABLE } from "../data/units.js";
import { POWERS } from "../data/powers.js";
import { executeMove } from "./movement.js";
import { resolveBattle, stepBattle, retreatBattle } from "./combat.js";
import { advancePhase, placeUnit, log } from "./phases.js";

// ============================================================================
// Action layer. Every change to the game goes through `applyAction`, which is
// a pure-ish function over a (cloned) GameState. The server runs it
// authoritatively; the client runs it for instant optimistic feedback. Each
// call returns whether it succeeded and any error text.
// ============================================================================

export type Action =
  | { kind: "buy"; units: { type: UnitTypeId; count: number }[] }
  | { kind: "cancel_purchases" }
  | { kind: "move"; from: string; to: string; unit: UnitTypeId; count: number }
  | { kind: "resolve_battle"; territory: string }
  | { kind: "battle_round"; territory: string }
  | { kind: "battle_retreat"; territory: string }
  | { kind: "place"; unit: UnitTypeId; territory: string }
  | { kind: "advance_phase" };

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function requireActive(state: GameState, actor: PowerId): string | null {
  if (state.winner) return "The game is over.";
  if (state.activePower !== actor) return `It is ${POWERS[state.activePower].display}'s turn, not yours.`;
  return null;
}

export function applyAction(state: GameState, action: Action, actor: PowerId): ActionResult {
  const turnError = requireActive(state, actor);
  if (turnError && action.kind !== "advance_phase") return { ok: false, error: turnError };

  switch (action.kind) {
    case "buy": {
      if (state.phase !== "purchase") return { ok: false, error: "You can only buy during the purchase phase." };
      let cost = 0;
      for (const item of action.units) {
        if (!PURCHASABLE.includes(item.type)) return { ok: false, error: `Cannot buy ${item.type}.` };
        if (item.count < 0) return { ok: false, error: "Invalid quantity." };
        cost += UNITS[item.type].cost * item.count;
      }
      if (cost > state.treasury[actor]) {
        return { ok: false, error: `Not enough IPC (need ${cost}, have ${state.treasury[actor]}).` };
      }
      state.treasury[actor] -= cost;
      for (const item of action.units) {
        if (item.count <= 0) continue;
        const existing = state.purchases.find((p) => p.type === item.type);
        if (existing) existing.count += item.count;
        else state.purchases.push({ type: item.type, count: item.count });
      }
      log(state, `${POWERS[actor].display} purchases units for ${cost} IPC.`);
      return { ok: true };
    }

    case "cancel_purchases": {
      if (state.phase !== "purchase") return { ok: false, error: "Nothing to cancel now." };
      let refund = 0;
      for (const p of state.purchases) refund += UNITS[p.type].cost * p.count;
      state.treasury[actor] += refund;
      state.purchases = [];
      log(state, `${POWERS[actor].display} cancels pending purchases (+${refund} IPC).`);
      return { ok: true };
    }

    case "move": {
      const res = executeMove(state, actor, {
        from: action.from,
        to: action.to,
        type: action.unit,
        count: action.count,
      });
      if (!res.ok) return { ok: false, error: res.reason };
      const verb = res.initiatesCombat ? "advances to attack" : "moves to";
      log(state, `${POWERS[actor].display} ${verb} ${action.to} (${action.count}× ${UNITS[action.unit].display}).`);
      return { ok: true };
    }

    case "resolve_battle": {
      if (state.phase !== "combat") return { ok: false, error: "Battles resolve during the combat phase." };
      const battle = state.combat.battles.find((b) => b.territory === action.territory);
      if (!battle || battle.resolved) return { ok: false, error: "No unresolved battle there." };
      const result = resolveBattle(state, action.territory);
      battle.resolved = true;
      for (const line of result.text) log(state, line);
      return { ok: true };
    }

    case "battle_round": {
      if (state.phase !== "combat") return { ok: false, error: "Battles resolve during the combat phase." };
      const battle = state.combat.battles.find((b) => b.territory === action.territory);
      if (!battle || battle.resolved) return { ok: false, error: "No unresolved battle there." };
      const { notes } = stepBattle(state, action.territory);
      for (const line of notes) log(state, line);
      return { ok: true };
    }

    case "battle_retreat": {
      if (state.phase !== "combat") return { ok: false, error: "Retreat happens during combat." };
      const battle = state.combat.battles.find((b) => b.territory === action.territory);
      if (!battle || battle.resolved) return { ok: false, error: "No unresolved battle there." };
      const { ok, notes } = retreatBattle(state, action.territory);
      for (const line of notes) log(state, line);
      return ok ? { ok: true } : { ok: false, error: notes[0] };
    }

    case "place": {
      const res = placeUnit(state, actor, action.unit, action.territory);
      return res.ok ? { ok: true } : { ok: false, error: res.reason };
    }

    case "advance_phase": {
      if (turnError) return { ok: false, error: turnError };
      advancePhase(state);
      return { ok: true };
    }

    default:
      return { ok: false, error: "Unknown action." };
  }
}
