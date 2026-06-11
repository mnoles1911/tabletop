import React from "react";
import {
  POWERS,
  TURN_ORDER,
  labelFor,
  expectedActor,
  type Action,
  type GameState,
  type PowerId,
  type UnitTypeId,
} from "@engine/index";
import type { GameView } from "../api.js";
import type { PanelProps } from "./panels/types.js";
import { PoliticsPanel } from "./panels/PoliticsPanel.js";
import { TechPanel } from "./panels/TechPanel.js";
import { PurchasePanel } from "./panels/PurchasePanel.js";
import { CombatMovePanel } from "./panels/CombatMovePanel.js";
import { BattlePanel } from "./panels/BattlePanel.js";
import { NonCombatPanel } from "./panels/NonCombatPanel.js";
import { PlacePanel } from "./panels/PlacePanel.js";
import { EndTurnPanel } from "./panels/EndTurnPanel.js";

interface Props {
  view: GameView;
  canAct: boolean;
  /** The power the local player is acting as (expectedActor when it's yours). */
  actingAs: PowerId | null;
  selectedTerr: string | null;
  selectedUnit: UnitTypeId | null;
  selectedCount: number;
  setSelectedUnit: (u: UnitTypeId | null) => void;
  setSelectedCount: (n: number) => void;
  mobilizeUnit: UnitTypeId | null;
  setMobilizeUnit: (u: UnitTypeId | null) => void;
  setHoverUnit: (h: { territory: string; type: UnitTypeId } | null) => void;
  act: (a: Action, as?: PowerId) => void;
  busy: boolean;
}

const PHASE_LABEL: Record<string, string> = {
  politics: "Politics",
  tech_research: "Research & Development",
  purchase: "Purchase Units",
  combat_move: "Combat Movement",
  combat: "Resolve Combat",
  noncombat_move: "Non-Combat Movement",
  mobilize: "Mobilize New Units",
  collect_income: "Collect Income",
};

export function Sidebar(props: Props) {
  const { view, act, busy, canAct, actingAs } = props;
  const { state } = view;
  const youSet = new Set(view.youPowers);
  const spectator = view.youPowers.length === 0;
  const expected = expectedActor(state);
  // During combat the local player may be the DEFENDER, acting out of turn.
  const defending = canAct && actingAs !== null && actingAs !== state.activePower;

  const panelProps: PanelProps = props;

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
        {spectator ? (
          <div className="hint">
            Spectating — the AI is playing this game. You can watch the board, treasuries and war log.
          </div>
        ) : (
          <div className="hint">
            {canAct
              ? defending
                ? `Defend! Answer the combat prompt for ${POWERS[actingAs!].display}.`
                : "Your move — act for the highlighted power."
              : `Waiting for ${POWERS[expected].display}.`}
            {view.youPowers.length > 0 && (
              <> You control: {view.youPowers.map((p) => POWERS[p].display).join(", ")}.</>
            )}
          </div>
        )}

        {state.winner && (
          <div className="card mt" style={{ minWidth: 0, borderColor: "var(--gold)" }}>
            🏆 <b>{state.winner} win the war!</b>
          </div>
        )}

        {canAct && !state.winner && !spectator && <PhasePanel {...panelProps} />}

        <Treasury state={state} youSet={youSet} />
        <Log state={state} />
      </div>

      {/* Finish Phase / End Turn — only the active player (not an out-of-turn
          defender, not a spectator) advances the phase. */}
      {canAct && !state.winner && !spectator && !defending && (
        <div className="sidebar-foot">
          <button className="gold" style={{ width: "100%" }} disabled={busy} onClick={() => act({ kind: "advance_phase" })}>
            {state.phase === "collect_income" ? "End Turn ▸" : `Finish ${labelFor(state.phase)} ▸`}
          </button>
        </div>
      )}
    </aside>
  );
}

function PhasePanel(props: PanelProps) {
  const { state } = props.view;
  // An out-of-turn defender only ever sees the BattlePanel (combat prompts).
  const defending = props.actingAs !== null && props.actingAs !== state.activePower;
  if (defending) return <BattlePanel {...props} />;

  switch (state.phase) {
    case "politics": return <PoliticsPanel {...props} />;
    case "tech_research": return <TechPanel {...props} />;
    case "purchase": return <PurchasePanel {...props} />;
    case "combat_move": return <CombatMovePanel {...props} />;
    case "combat": return <BattlePanel {...props} />;
    case "noncombat_move": return <NonCombatPanel {...props} />;
    case "mobilize": return <PlacePanel {...props} />;
    case "collect_income": return <EndTurnPanel {...props} />;
    default: return null;
  }
}

// --- Treasury & Log (shared, also shown read-only to spectators) -----------
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
