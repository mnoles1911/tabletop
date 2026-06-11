import React, { useState } from "react";
import {
  UNITS,
  POWERS,
  TERRITORY_INDEX,
  isSea,
  areEnemies,
  battleDefender,
  type Action,
  type BattleSide,
  type GameState,
  type PendingBattle,
  type PowerId,
  type UnitTypeId,
} from "@engine/index";
import type { PanelProps } from "./types.js";

// Combat phase: one card per unresolved battle. Shows both sides' forces, the
// fight controls (round / auto-resolve / retreat / submerge subs), the scramble
// prompt to the defender, and a casualty picker for whichever side YOU control.

export function BattlePanel({ view, act, busy, actingAs }: PanelProps) {
  const { state } = view;
  const you = new Set(view.youPowers);
  const battles = state.combat.battles.filter((b) => !b.resolved);
  if (battles.length === 0) return <div className="hint mt">No battles left. Finish the phase to continue.</div>;
  return (
    <div>
      <div className="section-title">Battles</div>
      {battles.map((b) => (
        <BattleCard key={b.territory} state={state} battle={b} you={you} actingAs={actingAs} act={act} busy={busy} />
      ))}
    </div>
  );
}

function defenderOf(state: GameState, b: PendingBattle): PowerId {
  return b.defender ?? battleDefender(state, b.territory, b.attacker);
}

/** Build a (type → count) force list for one owner-predicate in the zone. */
function forces(state: GameState, territory: string, keep: (owner: PowerId) => boolean) {
  const out: Array<{ type: UnitTypeId; count: number }> = [];
  for (const u of state.territories[territory].units) {
    if (!keep(u.owner)) continue;
    const e = out.find((x) => x.type === u.type);
    if (e) e.count += u.count;
    else out.push({ type: u.type, count: u.count });
  }
  return out;
}

function ForceList({ label, color, units }: { label: string; color: string; units: Array<{ type: UnitTypeId; count: number }> }) {
  return (
    <div className="force-col">
      <div className="force-head" style={{ color }}>{label}</div>
      {units.length === 0 ? (
        <div className="hint">—</div>
      ) : (
        units.map((u) => (
          <div className="force-row" key={u.type}>{u.count}× {UNITS[u.type].display}</div>
        ))
      )}
    </div>
  );
}

function BattleCard({ state, battle: b, you, actingAs, act, busy }: {
  state: GameState; battle: PendingBattle; you: Set<PowerId>; actingAs: PowerId | null;
  act: (a: Action, as?: PowerId) => void; busy: boolean;
}) {
  const attacker = b.attacker;
  const defender = defenderOf(state, b);
  const youAttack = you.has(attacker);
  const youDefend = you.has(defender);

  const atkForce = forces(state, b.territory, (o) => o === attacker);
  const defForce = forces(state, b.territory, (o) => areEnemies(state, o, attacker));

  // Submerge availability: my side has subs and the other side has no destroyer.
  const sea = isSea(b.territory);
  const noEnemyDestroyer = (mineEnemy: (o: PowerId) => boolean) =>
    !state.territories[b.territory].units.some((u) => mineEnemy(u.owner) && u.type === "destroyer");
  const canSubmerge = (side: BattleSide): boolean => {
    if (sea === false) return false;
    const mine = side === "attacker" ? (o: PowerId) => o === attacker : (o: PowerId) => areEnemies(state, o, attacker);
    const enemy = side === "attacker" ? (o: PowerId) => areEnemies(state, o, attacker) : (o: PowerId) => o === attacker;
    const hasSubs = state.territories[b.territory].units.some((u) => mine(u.owner) && u.type === "submarine");
    return hasSubs && noEnemyDestroyer(enemy);
  };

  const pendAtk = b.pendingAttackerHits ?? 0;
  const pendDef = b.pendingDefenderHits ?? 0;
  const myCasualtySide: BattleSide | null =
    pendAtk > 0 && youAttack ? "attacker" : pendDef > 0 && youDefend ? "defender" : null;
  const awaitingOther =
    (pendAtk > 0 && !youAttack) || (pendDef > 0 && !youDefend);

  return (
    <div className="battle-card">
      <div className="spread">
        <b>{b.sbr ? "💣 " : ""}{TERRITORY_INDEX[b.territory]?.display ?? b.territory}{b.amphibious ? " ⚓" : ""}</b>
        <span className="hint">{b.sbr ? "bombing raid" : `round ${b.roundsFought ?? 0}`}</span>
      </div>

      <div className="forces">
        <ForceList label={POWERS[attacker].display} color={POWERS[attacker].color} units={atkForce} />
        <ForceList label={POWERS[defender].display} color={POWERS[defender].color} units={defForce} />
      </div>

      {b.lastRound && (
        <div className="dice-line">
          <span>🎲 atk {b.lastRound.attackerRolls.join(",") || "—"} → {b.lastRound.attackerHits} hit</span>
          <span>🛡 def {b.lastRound.defenderRolls.join(",") || "—"} → {b.lastRound.defenderHits} hit</span>
        </div>
      )}

      {/* Scramble prompt — only to the defending player. */}
      {b.awaitingScramble && youDefend ? (
        <div className="scramble-prompt">
          <div className="hint" style={{ color: "var(--gold)" }}>Scramble aircraft to defend {TERRITORY_INDEX[b.territory]?.display ?? b.territory}?</div>
          <div className="row mt">
            <button className="primary" disabled={busy} onClick={() => act({ kind: "scramble", territory: b.territory }, defender)}>Scramble ✈</button>
            <button disabled={busy} onClick={() => act({ kind: "decline_scramble", territory: b.territory }, defender)}>Decline</button>
          </div>
        </div>
      ) : b.awaitingScramble ? (
        <div className="hint mt">Waiting for {POWERS[defender].display} to decide on scramble…</div>
      ) : myCasualtySide ? (
        <CasualtyChooser
          state={state}
          territory={b.territory}
          side={myCasualtySide}
          owner={myCasualtySide === "attacker" ? attacker : defender}
          hits={myCasualtySide === "attacker" ? pendAtk : pendDef}
          act={act}
          busy={busy}
        />
      ) : awaitingOther ? (
        <div className="hint mt">Waiting for {POWERS[pendAtk > 0 ? attacker : defender].display} to choose casualties…</div>
      ) : b.sbr ? (
        <div className="row mt"><button className="primary" disabled={busy} onClick={() => act({ kind: "resolve_battle", territory: b.territory })}>Resolve raid</button></div>
      ) : youAttack ? (
        <div className="row mt" style={{ flexWrap: "wrap", gap: 6 }}>
          <button className="primary" disabled={busy} onClick={() => act({ kind: "battle_round", territory: b.territory })}>⚔ Fight round</button>
          {!b.amphibious && <button disabled={busy} onClick={() => act({ kind: "battle_retreat", territory: b.territory })}>🏳 Retreat</button>}
          {canSubmerge("attacker") && <button disabled={busy} onClick={() => act({ kind: "battle_submerge", territory: b.territory, side: "attacker" })}>🌊 Submerge subs</button>}
          <button disabled={busy} onClick={() => act({ kind: "resolve_battle", territory: b.territory })}>⏩ Auto-resolve</button>
        </div>
      ) : (
        <div className="row mt" style={{ flexWrap: "wrap", gap: 6 }}>
          {youDefend && canSubmerge("defender") && <button disabled={busy} onClick={() => act({ kind: "battle_submerge", territory: b.territory, side: "defender" }, defender)}>🌊 Submerge subs</button>}
          <span className="hint">Waiting for {POWERS[attacker].display} to fight.</span>
        </div>
      )}
    </div>
  );
}

/** Pick which of YOUR units (the given side) absorb this round's hits. */
function CasualtyChooser({ state, territory, side, owner, hits, act, busy }: {
  state: GameState; territory: string; side: BattleSide; owner: PowerId; hits: number;
  act: (a: Action, as?: PowerId) => void; busy: boolean;
}) {
  const units = state.territories[territory].units.filter((u) => u.owner === owner);
  const [losses, setLosses] = useState<Record<string, number>>({});
  const chosen = Object.values(losses).reduce((a, b) => a + b, 0);
  const bump = (t: UnitTypeId, d: number, max: number) => setLosses((l) => ({ ...l, [t]: Math.max(0, Math.min(max, (l[t] ?? 0) + d)) }));
  return (
    <div className="casualty-picker mt">
      <div className="hint" style={{ color: "var(--danger)" }}>
        {side === "attacker" ? "Attacker" : "Defender"} casualties — choose {hits} ({chosen}/{hits}):
      </div>
      {units.map((u) => (
        <div className="buy-row" key={u.type}>
          <span>{UNITS[u.type].display} ×{u.count}</span>
          <span className="qty">
            <button onClick={() => bump(u.type, -1, u.count)} disabled={!losses[u.type]}>−</button>
            <b>{losses[u.type] ?? 0}</b>
            <button onClick={() => bump(u.type, +1, u.count)} disabled={chosen >= hits}>+</button>
          </span>
        </div>
      ))}
      <div className="row mt">
        <button
          className="primary"
          disabled={busy || chosen !== hits}
          onClick={() => act({ kind: "assign_casualties", territory, side, losses: Object.entries(losses).filter(([, n]) => n > 0).map(([type, count]) => ({ type: type as UnitTypeId, count })) }, owner)}
        >Confirm</button>
        <button disabled={busy} onClick={() => act({ kind: "auto_casualties", territory, side }, owner)}>Auto (cheapest)</button>
      </div>
    </div>
  );
}
