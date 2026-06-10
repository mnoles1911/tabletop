import React, { useState } from "react";
import {
  UNITS,
  PURCHASABLE,
  POWERS,
  TURN_ORDER,
  TERRITORY_INDEX,
  TERRITORIES,
  hasFlag,
  isSea,
  neighbours,
  checkTransport,
  checkMove,
  remainingCapacity,
  collectibleIncome,
  territoryIncome,
  nationalObjectiveBonus,
  RESEARCH_DIE_COST,
  techName,
  ALL_TECHS,
  TECH_NAMES,
  areEnemies,
  type Action,
  type GameState,
  type PowerId,
  type TechId,
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

      <RepairPanel state={state} active={active} act={act} busy={busy} />
      {state.options.research && <ResearchPanel state={state} active={active} act={act} busy={busy} />}
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

function ResearchPanel({ state, active, act, busy }: { state: GameState; active: PowerId; act: (a: Action) => void; busy: boolean }) {
  const [dice, setDice] = useState(1);
  const owned = new Set(state.tech[active] ?? []);
  const cost = dice * RESEARCH_DIE_COST;
  return (
    <div className="mt">
      <div className="section-title">Research &amp; Development</div>
      <div className="spread">
        <span className="qty">
          <button onClick={() => setDice(Math.max(1, dice - 1))}>−</button>
          <b>{dice}</b> die{dice > 1 ? "s" : ""}
          <button onClick={() => setDice(dice + 1)} disabled={cost + RESEARCH_DIE_COST > state.treasury[active]}>+</button>
        </span>
        <button className="primary" disabled={busy || cost > state.treasury[active]} onClick={() => act({ kind: "research", dice })}>
          Roll ({cost} IPC)
        </button>
      </div>
      <div className="hint mt">
        Techs: {ALL_TECHS.map((t) => (owned.has(t) ? `✓ ${TECH_NAMES[t]}` : null)).filter(Boolean).join(", ") || "none yet"}
      </div>
    </div>
  );
}

// --- Movement --------------------------------------------------------------
function MovePanel({ view, selectedTerr, selectedUnit, selectedCount, setSelectedUnit, setSelectedCount, act, busy }: Props) {
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

      <TransportSection state={state} active={active} from={selectedTerr} unit={selectedUnit} count={selectedCount} act={act} busy={busy} />
      <SbrSection state={state} active={active} from={selectedTerr} act={act} busy={busy} />
    </div>
  );
}

/** Sea-lift / amphibious assault from a coastal territory across owned transports. */
function TransportSection({ state, active, from, unit, count, act, busy }: { state: GameState; active: PowerId; from: string; unit: UnitTypeId | null; count: number; act: (a: Action) => void; busy: boolean }) {
  if (isSea(from)) return null;
  if (state.phase !== "combat_move" && state.phase !== "noncombat_move") return null;
  if (!unit || UNITS[unit].domain !== "land") return null;
  // Sea zones adjacent to `from` where the player has transports.
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
    if (!ts.controller || !areEnemies(ts.controller, active)) return false;
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

// --- Combat (interactive: fight a round, retreat, pick casualties) ----------
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
            <b>{b.sbr ? "💣 " : ""}{TERRITORY_INDEX[b.territory].display}{b.amphibious ? " (amphibious)" : ""}</b>
            <span className="hint">{b.sbr ? "bombing raid" : `round ${b.roundsFought ?? 0}`}</span>
          </div>
          {b.lastRound && (
            <div className="dice-line">
              <span>🎲 atk {b.lastRound.attackerRolls.join(",") || "—"} → {b.lastRound.attackerHits} hit</span>
              <span>🛡 def {b.lastRound.defenderRolls.join(",") || "—"} → {b.lastRound.defenderHits} hit</span>
            </div>
          )}
          {(b.pendingAttackerHits ?? 0) > 0 ? (
            <CasualtyChooser state={state} territory={b.territory} hits={b.pendingAttackerHits!} act={act} busy={busy} />
          ) : b.sbr ? (
            <div className="row mt"><button className="primary" disabled={busy} onClick={() => act({ kind: "resolve_battle", territory: b.territory })}>Resolve raid</button></div>
          ) : (
            <div className="row mt" style={{ flexWrap: "wrap", gap: 6 }}>
              <button className="primary" disabled={busy} onClick={() => act({ kind: "battle_round", territory: b.territory })}>⚔ Fight round</button>
              {!b.amphibious && <button disabled={busy} onClick={() => act({ kind: "battle_retreat", territory: b.territory })}>🏳 Retreat</button>}
              <button disabled={busy} onClick={() => act({ kind: "resolve_battle", territory: b.territory })}>⏩ Auto</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Pick which attacking units absorb this round's hits. */
function CasualtyChooser({ state, territory, hits, act, busy }: { state: GameState; territory: string; hits: number; act: (a: Action) => void; busy: boolean }) {
  const attacker = state.combat.battles.find((b) => b.territory === territory)!.attacker;
  const units = state.territories[territory].units.filter((u) => u.owner === attacker);
  const [losses, setLosses] = useState<Record<string, number>>({});
  const chosen = Object.values(losses).reduce((a, b) => a + b, 0);
  const bump = (t: UnitTypeId, d: number, max: number) => setLosses((l) => ({ ...l, [t]: Math.max(0, Math.min(max, (l[t] ?? 0) + d)) }));
  return (
    <div className="mt">
      <div className="hint" style={{ color: "var(--danger)" }}>Choose {hits} casualt{hits > 1 ? "ies" : "y"} ({chosen}/{hits}):</div>
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
        <button className="primary" disabled={busy || chosen !== hits} onClick={() => act({ kind: "assign_casualties", territory, losses: Object.entries(losses).filter(([, n]) => n > 0).map(([type, count]) => ({ type: type as UnitTypeId, count })) })}>Confirm</button>
        <button disabled={busy} onClick={() => act({ kind: "auto_casualties", territory })}>Auto (cheapest)</button>
      </div>
    </div>
  );
}

// --- Mobilize --------------------------------------------------------------
function MobilizePanel({ view, mobilizeUnit, setMobilizeUnit }: Props) {
  const { state } = view;
  const active = state.activePower;
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
