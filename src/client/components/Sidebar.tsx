import React, { useState } from "react";
import {
  UNITS,
  PURCHASABLE,
  POWERS,
  TURN_ORDER,
  TERRITORY_INDEX,
  collectibleIncome,
  territoryIncome,
  nationalObjectiveBonus,
  type Action,
  type GameState,
  type PowerId,
  type UnitTypeId,
} from "@engine/index";
import type { GameView } from "../api.js";

interface Props {
  view: GameView;
  canAct: boolean;
  selectedTerr: string | null;
  selectedUnit: UnitTypeId | null;
  selectedCount: number;
  setSelectedUnit: (u: UnitTypeId | null) => void;
  setSelectedCount: (n: number) => void;
  mobilizeUnit: UnitTypeId | null;
  setMobilizeUnit: (u: UnitTypeId | null) => void;
  act: (a: Action) => void;
  busy: boolean;
}

const PHASE_LABEL: Record<string, string> = {
  purchase: "Purchase Units",
  combat_move: "Combat Movement",
  combat: "Resolve Combat",
  noncombat_move: "Non-Combat Movement",
  mobilize: "Mobilize New Units",
  collect_income: "Collect Income",
};

export function Sidebar(props: Props) {
  const { view, act, busy, canAct } = props;
  const { state } = view;
  const youSet = new Set(view.youPowers);

  return (
    <aside className="sidebar">
      <header>
        <div>
          <span className="phase-pill">Round {state.round}</span>{" "}
          <span className="active-power" style={{ color: POWERS[state.activePower].color }}>
            {POWERS[state.activePower].display}
          </span>
        </div>
        <span className="phase-pill">{PHASE_LABEL[state.phase]}</span>
      </header>

      <div className="scroll">
        <div className="hint">
          {canAct
            ? "Your move — act for the highlighted power."
            : `Waiting for ${POWERS[state.activePower].display}.`}
          {view.youPowers.length > 0 && (
            <> You control: {view.youPowers.map((p) => POWERS[p].display).join(", ")}.</>
          )}
        </div>

        {state.winner && (
          <div className="card mt" style={{ minWidth: 0, borderColor: "var(--gold)" }}>
            🏆 <b>{state.winner} win the war!</b>
          </div>
        )}

        {canAct && !state.winner && <PhasePanel {...props} />}

        <Treasury state={state} youSet={youSet} />
        <Log state={state} />
      </div>

      {canAct && !state.winner && (
        <div className="sidebar-foot">
          <button className="gold" style={{ width: "100%" }} disabled={busy} onClick={() => act({ kind: "advance_phase" })}>
            {state.phase === "collect_income" ? "End Turn ▸" : `Finish ${PHASE_LABEL[state.phase]} ▸`}
          </button>
        </div>
      )}
    </aside>
  );
}

function PhasePanel(props: Props) {
  switch (props.view.state.phase) {
    case "purchase": return <PurchasePanel {...props} />;
    case "combat_move":
    case "noncombat_move": return <MovePanel {...props} />;
    case "combat": return <CombatPanel {...props} />;
    case "mobilize": return <MobilizePanel {...props} />;
    case "collect_income": return <IncomePanel {...props} />;
    default: return null;
  }
}

// --- Purchase --------------------------------------------------------------
function PurchasePanel({ view, act, busy }: Props) {
  const { state, youPowers } = view;
  const active = state.activePower;
  const [cart, setCart] = useState<Record<string, number>>({});
  const total = Object.entries(cart).reduce((s, [t, n]) => s + UNITS[t as UnitTypeId].cost * n, 0);
  const treasury = state.treasury[active];
  const bump = (t: UnitTypeId, d: number) => setCart((c) => ({ ...c, [t]: Math.max(0, (c[t] ?? 0) + d) }));

  return (
    <div>
      <div className="section-title">Buy units — {treasury} IPC available</div>
      {PURCHASABLE.map((t) => {
        const u = UNITS[t];
        return (
          <div className="buy-row" key={t}>
            <span>{u.display} <span className="hint">({u.cost})</span></span>
            <span className="qty">
              <button onClick={() => bump(t, -1)} disabled={!cart[t]}>−</button>
              <b>{cart[t] ?? 0}</b>
              <button onClick={() => bump(t, +1)} disabled={total + u.cost > treasury}>+</button>
            </span>
          </div>
        );
      })}
      <div className="spread mt">
        <b>Total: {total} IPC</b>
        <div className="row">
          <button onClick={() => setCart({})} disabled={busy || total === 0}>Clear</button>
          <button
            className="primary"
            disabled={busy || total === 0}
            onClick={() => {
              const units = Object.entries(cart).filter(([, n]) => n > 0).map(([type, count]) => ({ type: type as UnitTypeId, count }));
              act({ kind: "buy", units });
              setCart({});
            }}
          >Buy</button>
        </div>
      </div>
      {state.purchases.length > 0 && (
        <div className="hint mt">
          Queued: {state.purchases.map((p) => `${p.count}× ${UNITS[p.type].display}`).join(", ")}
          <div><button className="mt" onClick={() => act({ kind: "cancel_purchases" })} disabled={busy}>Refund all</button></div>
        </div>
      )}
    </div>
  );
}

// --- Movement --------------------------------------------------------------
function MovePanel({ view, selectedTerr, selectedUnit, selectedCount, setSelectedUnit, setSelectedCount }: Props) {
  const { state } = view;
  const active = state.activePower;
  if (!selectedTerr) return <div className="hint mt">Tap a territory with your units to move them.</div>;
  const yours = state.territories[selectedTerr].units.filter((u) => u.owner === active);
  return (
    <div>
      <div className="section-title">Move from {TERRITORY_INDEX[selectedTerr].display}</div>
      {yours.length === 0 && <div className="hint">No units of yours here.</div>}
      {yours.map((u) => (
        <div className="buy-row" key={u.type} style={{ borderColor: selectedUnit === u.type ? "var(--gold)" : undefined }}>
          <label className="row" style={{ cursor: "pointer" }} onClick={() => { setSelectedUnit(u.type); setSelectedCount(Math.min(selectedCount || 1, u.count)); }}>
            <input type="radio" checked={selectedUnit === u.type} readOnly /> {UNITS[u.type].display} ×{u.count}
          </label>
          {selectedUnit === u.type && (
            <span className="qty">
              <button onClick={() => setSelectedCount(Math.max(1, selectedCount - 1))}>−</button>
              <b>{selectedCount}</b>
              <button onClick={() => setSelectedCount(Math.min(u.count, selectedCount + 1))}>+</button>
            </span>
          )}
        </div>
      ))}
      {selectedUnit && <div className="hint mt">Tap a green destination to move {selectedCount}× {UNITS[selectedUnit].display}.</div>}
    </div>
  );
}

// --- Combat (interactive: fight a round, retreat, or auto-resolve) ----------
function CombatPanel({ view, act, busy }: Props) {
  const { state } = view;
  const battles = state.combat.battles.filter((b) => !b.resolved);
  if (battles.length === 0) return <div className="hint mt">No battles left. Finish the phase to continue.</div>;
  return (
    <div>
      <div className="section-title">Battles</div>
      {battles.map((b) => (
        <div className="battle-card" key={b.territory}>
          <div className="spread">
            <b>{TERRITORY_INDEX[b.territory].display}</b>
            <span className="hint">round {b.roundsFought ?? 0}</span>
          </div>
          {b.lastRound && (
            <div className="dice-line">
              <span>🎲 atk {b.lastRound.attackerRolls.join(",") || "—"} → {b.lastRound.attackerHits} hit</span>
              <span>🛡 def {b.lastRound.defenderRolls.join(",") || "—"} → {b.lastRound.defenderHits} hit</span>
            </div>
          )}
          <div className="row mt" style={{ flexWrap: "wrap", gap: 6 }}>
            <button className="primary" disabled={busy} onClick={() => act({ kind: "battle_round", territory: b.territory })}>⚔ Fight round</button>
            <button disabled={busy} onClick={() => act({ kind: "battle_retreat", territory: b.territory })}>🏳 Retreat</button>
            <button disabled={busy} onClick={() => act({ kind: "resolve_battle", territory: b.territory })}>⏩ Auto</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Mobilize --------------------------------------------------------------
function MobilizePanel({ view, mobilizeUnit, setMobilizeUnit }: Props) {
  const { state } = view;
  if (state.purchases.length === 0) return <div className="hint mt">Nothing left to place. Finish the phase.</div>;
  return (
    <div>
      <div className="section-title">Place purchased units</div>
      {state.purchases.map((p) => (
        <div className="buy-row" key={p.type} style={{ borderColor: mobilizeUnit === p.type ? "var(--gold)" : undefined }} onClick={() => setMobilizeUnit(p.type)}>
          <span>{UNITS[p.type].display}</span><b>×{p.count}</b>
        </div>
      ))}
      {mobilizeUnit && <div className="hint mt">Tap a highlighted factory/territory to place {UNITS[mobilizeUnit].display}.</div>}
    </div>
  );
}

// --- Income ----------------------------------------------------------------
function IncomePanel({ view }: Props) {
  const { state } = view;
  const active = state.activePower;
  const base = territoryIncome(state, active);
  const no = nationalObjectiveBonus(state, active);
  const total = collectibleIncome(state, active);
  return (
    <div className="hint mt">
      Territory income: <b>{base}</b>{no > 0 && <> + National Objectives <b style={{ color: "var(--gold)" }}>{no}</b></>}.
      <br />This turn {POWERS[active].display} banks <b style={{ color: "var(--gold)" }}>{total} IPC</b>. End the turn to collect.
    </div>
  );
}

// --- Treasury & Log --------------------------------------------------------
function Treasury({ state, youSet }: { state: GameState; youSet: Set<PowerId> }) {
  return (
    <div>
      <div className="section-title">Treasuries</div>
      <div className="treasury-grid">
        {TURN_ORDER.map((p) => (
          <React.Fragment key={p}>
            <span className={youSet.has(p) ? "you" : ""}>
              <span className="swatch" style={{ background: POWERS[p].color }} />
              {POWERS[p].display}
            </span>
            <span className={youSet.has(p) ? "you" : ""}>{state.treasury[p]}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function Log({ state }: { state: GameState }) {
  const recent = state.log.slice(-40).reverse();
  return (
    <div>
      <div className="section-title">War log</div>
      <div className="log">
        {recent.map((l, i) => (
          <div key={i} className={i < 2 ? "new" : ""}>
            <span style={{ color: POWERS[l.power]?.color }}>•</span> {l.text}
          </div>
        ))}
      </div>
    </div>
  );
}
