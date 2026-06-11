import React, { useState } from "react";
import { UNITS, PURCHASABLE, TERRITORIES, type Action, type GameState, type PowerId, type UnitTypeId } from "@engine/index";
import type { PanelProps } from "./types.js";
import { Adm } from "./Adm.js";

// Purchase phase: buy units, refund queued purchases, and repair factories.

export function PurchasePanel({ view, act, busy, actingAs }: PanelProps) {
  const { state } = view;
  const active = actingAs ?? state.activePower;
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
            <span>{u.display} <span className="hint">({u.cost})</span> <Adm type={t} /></span>
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

      <RepairPanel state={state} active={active} act={act} busy={busy} />
    </div>
  );
}

function RepairPanel({ state, active, act, busy }: { state: GameState; active: PowerId; act: (a: Action) => void; busy: boolean }) {
  const damaged = TERRITORIES.filter(
    (t) => state.territories[t.id].controller === active && (state.territories[t.id].factoryDamage ?? 0) > 0,
  );
  if (damaged.length === 0) return null;
  return (
    <div className="mt">
      <div className="section-title">Repair factories</div>
      {damaged.map((t) => {
        const dmg = state.territories[t.id].factoryDamage ?? 0;
        return (
          <div className="buy-row" key={t.id}>
            <span>{t.display} <span className="hint">({dmg} dmg)</span></span>
            <button className="primary" disabled={busy || state.treasury[active] < 1} onClick={() => act({ kind: "repair", territory: t.id, amount: dmg })}>
              Repair {dmg} IPC
            </button>
          </div>
        );
      })}
    </div>
  );
}
