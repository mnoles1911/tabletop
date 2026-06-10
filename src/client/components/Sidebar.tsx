import React, { useState } from "react";
import {
  UNITS,
  PURCHASABLE,
  POWERS,
  TURN_ORDER,
  TERRITORY_INDEX,
  collectibleIncome,
  type Action,
  type GameState,
  type PowerId,
  type UnitTypeId,
} from "@engine/index";
import type { GameView } from "../api.js";

interface Props {
  view: GameView;
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
  const { view, act, busy } = props;
  const { state, you } = view;
  const isYourTurn = you === state.activePower;

  return (
    <aside className="sidebar">
      <header>
        <div>
          <div className="phase-pill">Round {state.round}</div>{" "}
          <span className="active-power" style={{ color: POWERS[state.activePower].color }}>
            {POWERS[state.activePower].display}
          </span>
        </div>
        <div className="phase-pill">{PHASE_LABEL[state.phase]}</div>
      </header>

      <div className="scroll">
        {you ? (
          <div className="hint">
            You are <b style={{ color: POWERS[you].color }}>{POWERS[you].display}</b>.{" "}
            {isYourTurn ? "It's your move." : `Waiting for ${POWERS[state.activePower].display}.`}
          </div>
        ) : (
          <div className="hint">Spectating — open a seat to play.</div>
        )}

        {state.winner && (
          <div className="card mt" style={{ minWidth: 0, borderColor: "var(--gold)" }}>
            🏆 <b>{state.winner} win the war!</b>
          </div>
        )}

        {/* Phase-specific controls (only when it's your turn) */}
        {isYourTurn && !state.winner && (
          <PhasePanel {...props} />
        )}

        <Treasury state={state} you={you} />
        <Log state={state} />
      </div>

      {isYourTurn && !state.winner && (
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
          <button
            className="gold"
            style={{ width: "100%" }}
            disabled={busy}
            onClick={() => act({ kind: "advance_phase" })}
          >
            {state.phase === "collect_income" ? "End Turn ▸" : `Finish ${PHASE_LABEL[state.phase]} ▸`}
          </button>
        </div>
      )}
    </aside>
  );
}

function PhasePanel(props: Props) {
  const { state } = props.view;
  switch (state.phase) {
    case "purchase":
      return <PurchasePanel {...props} />;
    case "combat_move":
    case "noncombat_move":
      return <MovePanel {...props} />;
    case "combat":
      return <CombatPanel {...props} />;
    case "mobilize":
      return <MobilizePanel {...props} />;
    case "collect_income":
      return <IncomePanel {...props} />;
    default:
      return null;
  }
}

// --- Purchase --------------------------------------------------------------
function PurchasePanel({ view, act, busy }: Props) {
  const { state, you } = view;
  const [cart, setCart] = useState<Record<string, number>>({});
  const total = Object.entries(cart).reduce((s, [t, n]) => s + UNITS[t as UnitTypeId].cost * n, 0);
  const treasury = you ? state.treasury[you] : 0;
  const bump = (t: UnitTypeId, d: number) =>
    setCart((c) => ({ ...c, [t]: Math.max(0, (c[t] ?? 0) + d) }));

  return (
    <div>
      <div className="section-title">Buy units — {treasury} IPC available</div>
      {PURCHASABLE.map((t) => {
        const u = UNITS[t];
        return (
          <div className="buy-row" key={t}>
            <span>
              {u.display} <span className="hint">({u.cost})</span>
            </span>
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
              const units = Object.entries(cart)
                .filter(([, n]) => n > 0)
                .map(([type, count]) => ({ type: type as UnitTypeId, count }));
              act({ kind: "buy", units });
              setCart({});
            }}
          >
            Buy
          </button>
        </div>
      </div>
      {state.purchases.length > 0 && (
        <div className="hint mt">
          Queued for mobilize:{" "}
          {state.purchases.map((p) => `${p.count}× ${UNITS[p.type].display}`).join(", ")}
          <div>
            <button className="mt" onClick={() => act({ kind: "cancel_purchases" })} disabled={busy}>
              Refund all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Movement --------------------------------------------------------------
function MovePanel(props: Props) {
  const { view, selectedTerr, selectedUnit, selectedCount, setSelectedUnit, setSelectedCount } = props;
  const { state, you } = view;
  if (!selectedTerr) {
    return <div className="hint mt">Click a territory with your units to move them.</div>;
  }
  const ts = state.territories[selectedTerr];
  const yours = ts.units.filter((u) => u.owner === you);
  return (
    <div>
      <div className="section-title">Move from {TERRITORY_INDEX[selectedTerr].display}</div>
      {yours.length === 0 && <div className="hint">No units of yours here.</div>}
      {yours.map((u) => (
        <div
          className="buy-row"
          key={u.type}
          style={{ borderColor: selectedUnit === u.type ? "var(--gold)" : undefined }}
        >
          <label className="row" style={{ cursor: "pointer" }} onClick={() => { setSelectedUnit(u.type); setSelectedCount(Math.min(selectedCount || 1, u.count)); }}>
            <input type="radio" checked={selectedUnit === u.type} readOnly />
            {UNITS[u.type].display} ×{u.count}
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
      {selectedUnit && (
        <div className="hint mt">
          Now click a green destination on the map to move {selectedCount}× {UNITS[selectedUnit].display}.
        </div>
      )}
    </div>
  );
}

// --- Combat ----------------------------------------------------------------
function CombatPanel({ view, act, busy }: Props) {
  const { state } = view;
  const battles = state.combat.battles.filter((b) => !b.resolved);
  if (battles.length === 0) {
    return <div className="hint mt">No battles to resolve. Finish the phase to continue.</div>;
  }
  return (
    <div>
      <div className="section-title">Pending battles</div>
      {battles.map((b) => (
        <div className="buy-row" key={b.territory}>
          <span>{TERRITORY_INDEX[b.territory].display}</span>
          <button
            className="primary"
            disabled={busy}
            onClick={() => act({ kind: "resolve_battle", territory: b.territory })}
          >
            ⚔ Resolve
          </button>
        </div>
      ))}
    </div>
  );
}

// --- Mobilize --------------------------------------------------------------
function MobilizePanel(props: Props) {
  const { view, mobilizeUnit, setMobilizeUnit } = props;
  const { state } = view;
  if (state.purchases.length === 0) {
    return <div className="hint mt">Nothing left to place. Finish the phase.</div>;
  }
  return (
    <div>
      <div className="section-title">Place purchased units</div>
      {state.purchases.map((p) => (
        <div
          className="buy-row"
          key={p.type}
          style={{ borderColor: mobilizeUnit === p.type ? "var(--gold)" : undefined }}
          onClick={() => setMobilizeUnit(p.type)}
        >
          <span>{UNITS[p.type].display}</span>
          <b>×{p.count}</b>
        </div>
      ))}
      {mobilizeUnit && (
        <div className="hint mt">Click a highlighted factory/territory to place {UNITS[mobilizeUnit].display}.</div>
      )}
    </div>
  );
}

// --- Income ----------------------------------------------------------------
function IncomePanel({ view }: Props) {
  const { state, you } = view;
  const income = you ? collectibleIncome(state, state.activePower) : 0;
  return (
    <div className="hint mt">
      This turn {POWERS[state.activePower].display} will bank <b style={{ color: "var(--gold)" }}>{income} IPC</b>.
      End the turn to collect and pass play.
    </div>
  );
}

// --- Treasury & Log --------------------------------------------------------
function Treasury({ state, you }: { state: GameState; you: PowerId | null }) {
  return (
    <div>
      <div className="section-title">Treasuries</div>
      <div className="treasury-grid">
        {TURN_ORDER.map((p) => (
          <React.Fragment key={p}>
            <span className={you === p ? "you" : ""}>
              <span className="swatch" style={{ background: POWERS[p].color }} />
              {POWERS[p].display}
            </span>
            <span className={you === p ? "you" : ""}>{state.treasury[p]}</span>
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
