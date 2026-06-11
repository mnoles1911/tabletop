import React from "react";
import {
  UNITS,
  TERRITORY_INDEX,
  TERRITORIES,
  hasFlag,
  isSea,
  neighbours,
  checkTransport,
  checkMove,
  areEnemies,
  type Action,
  type GameState,
  type PowerId,
  type UnitTypeId,
} from "@engine/index";
import { Adm } from "./Adm.js";

interface MoveProps {
  state: GameState;
  active: PowerId;
  selectedTerr: string | null;
  selectedUnit: UnitTypeId | null;
  selectedCount: number;
  setSelectedUnit: (u: UnitTypeId | null) => void;
  setSelectedCount: (n: number) => void;
  setHoverUnit: (h: { territory: string; type: UnitTypeId } | null) => void;
  act: (a: Action) => void;
  busy: boolean;
}

/** Shared move UI: pick a unit stack, preview range, transport & bomb (combat). */
export function MoveControls({
  state, active, selectedTerr, selectedUnit, selectedCount,
  setSelectedUnit, setSelectedCount, setHoverUnit, act, busy,
}: MoveProps) {
  if (!selectedTerr) return <div className="hint mt">Tap a territory with your units to move them.</div>;
  const yours = state.territories[selectedTerr].units.filter((u) => u.owner === active);
  const combat = state.phase === "combat_move";
  return (
    <div>
      <div className="section-title">Move from {TERRITORY_INDEX[selectedTerr].display}</div>
      {yours.length === 0 && <div className="hint">No units of yours here.</div>}
      {yours.map((u) => (
        <div
          className="buy-row"
          key={u.type}
          style={{ borderColor: selectedUnit === u.type ? "var(--gold)" : undefined }}
          onMouseEnter={() => setHoverUnit({ territory: selectedTerr, type: u.type })}
          onMouseLeave={() => setHoverUnit(null)}
        >
          <label className="row" style={{ cursor: "pointer" }} onClick={() => { setSelectedUnit(u.type); setSelectedCount(Math.min(selectedCount || 1, u.count)); }}>
            <input type="radio" checked={selectedUnit === u.type} readOnly /> {UNITS[u.type].display} ×{u.count} <Adm type={u.type} />
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
      <div className="hint mt">
        {combat ? "Hover a unit to preview its attack range" : "Hover a unit to preview where it can move"} (cyan).
        {selectedUnit && <> Tap a green destination to move {selectedCount}× {UNITS[selectedUnit].display}.</>}
      </div>

      <TransportSection state={state} active={active} from={selectedTerr} unit={selectedUnit} count={selectedCount} act={act} busy={busy} />
      {combat && <SbrSection state={state} active={active} from={selectedTerr} act={act} busy={busy} />}
    </div>
  );
}

/** Sea-lift / amphibious assault from a coastal territory across owned transports. */
function TransportSection({ state, active, from, unit, count, act, busy }: { state: GameState; active: PowerId; from: string; unit: UnitTypeId | null; count: number; act: (a: Action) => void; busy: boolean }) {
  if (isSea(from)) return null;
  if (state.phase !== "combat_move" && state.phase !== "noncombat_move") return null;
  if (!unit || UNITS[unit].domain !== "land") return null;
  const zones = neighbours(from).filter(
    (n) => isSea(n) && state.territories[n].units.some((u) => u.owner === active && u.type === "transport"),
  );
  if (zones.length === 0) return null;

  const destinations: Array<{ via: string; to: string; amph: boolean }> = [];
  for (const via of zones) {
    for (const to of neighbours(via)) {
      if (isSea(to) || to === from) continue;
      const chk = checkTransport(state, active, { from, via, to, units: [{ type: unit, count }] });
      if (chk.ok) destinations.push({ via, to, amph: !!chk.amphibious });
    }
  }
  if (destinations.length === 0) return null;

  return (
    <div className="mt">
      <div className="section-title">🚢 Sea transport — {count}× {UNITS[unit].display}</div>
      {destinations.map((d) => (
        <div className="buy-row" key={`${d.via}>${d.to}`}>
          <span>{d.amph ? "⚔ Assault" : "Land at"} {TERRITORY_INDEX[d.to].display} <span className="hint">via {TERRITORY_INDEX[d.via].display}</span></span>
          <button className={d.amph ? "primary" : ""} disabled={busy} onClick={() => act({ kind: "transport", from, via: d.via, to: d.to, units: [{ type: unit, count }] })}>
            {d.amph ? "Invade" : "Ferry"}
          </button>
        </div>
      ))}
    </div>
  );
}

/** Strategic bombing: send bombers from this territory at enemy factories. */
function SbrSection({ state, active, from, act, busy }: { state: GameState; active: PowerId; from: string; act: (a: Action) => void; busy: boolean }) {
  if (state.phase !== "combat_move") return null;
  const bombers = state.territories[from].units.find((u) => u.owner === active && u.type === "strategic_bomber")?.count ?? 0;
  if (bombers === 0) return null;
  const targets = TERRITORIES.filter((t) => {
    const ts = state.territories[t.id];
    if (!ts.controller || !areEnemies(state, ts.controller, active)) return false;
    if (!ts.units.some((u) => hasFlag(u.type, "factory"))) return false;
    return checkMove(state, active, { from, to: t.id, type: "strategic_bomber", count: bombers }).ok;
  });
  if (targets.length === 0) return null;
  return (
    <div className="mt">
      <div className="section-title">💣 Strategic bombing ({bombers} bomber{bombers > 1 ? "s" : ""})</div>
      {targets.map((t) => (
        <div className="buy-row" key={t.id}>
          <span>{t.display}</span>
          <button className="primary" disabled={busy} onClick={() => act({ kind: "strategic_bomb", from, to: t.id, count: bombers })}>Raid</button>
        </div>
      ))}
    </div>
  );
}
