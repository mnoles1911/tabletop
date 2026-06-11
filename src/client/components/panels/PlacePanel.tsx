import React from "react";
import { UNITS, TERRITORIES, hasFlag, remainingCapacity } from "@engine/index";
import type { PanelProps } from "./types.js";

// Mobilize phase: place purchased units at factories.

export function PlacePanel({ view, mobilizeUnit, setMobilizeUnit, actingAs }: PanelProps) {
  const { state } = view;
  const active = actingAs ?? state.activePower;
  if (state.purchases.length === 0) return <div className="hint mt">Nothing left to place. Finish the phase.</div>;
  const factories = TERRITORIES.filter(
    (t) => state.territories[t.id].controller === active && state.territories[t.id].units.some((u) => hasFlag(u.type, "factory") && u.owner === active),
  );
  return (
    <div>
      <div className="section-title">Place purchased units</div>
      {state.purchases.map((p) => (
        <div className="buy-row" key={p.type} style={{ borderColor: mobilizeUnit === p.type ? "var(--gold)" : undefined }} onClick={() => setMobilizeUnit(p.type)}>
          <span>{UNITS[p.type].display}</span><b>×{p.count}</b>
        </div>
      ))}
      {mobilizeUnit && <div className="hint mt">Tap a highlighted factory/territory to place {UNITS[mobilizeUnit].display}.</div>}
      <div className="hint mt">
        Factory capacity left:{" "}
        {factories.map((f) => `${f.display} ${remainingCapacity(state, active, f.id)}`).join(" · ") || "—"}
      </div>
    </div>
  );
}
