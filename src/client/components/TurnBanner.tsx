import React from "react";
import { POWERS, TURN_ORDER, PHASE_ORDER, labelFor, expectedActor, type GameState } from "@engine/index";

// ============================================================================
// A slim horizontal strip above the board: the powers in turn order as colored
// chips (active one highlighted, AI marked with a robot, eliminated dimmed),
// and below them the 8 phase pips with the current phase lit.
// ============================================================================

export function TurnBanner({ state }: { state: GameState }) {
  const active = state.activePower;
  const expecting = expectedActor(state);
  const eliminated = new Set(state.eliminated ?? []);

  return (
    <div className="turn-banner">
      <div className="tb-powers">
        {TURN_ORDER.map((p) => {
          const ai = state.powerControl?.[p] === "ai";
          const isActive = p === active;
          const isExpecting = p === expecting; // may be a defender out of turn
          const dead = eliminated.has(p);
          return (
            <span
              key={p}
              className={`tb-chip${isActive ? " active" : ""}${isExpecting && !isActive ? " expecting" : ""}${dead ? " dead" : ""}`}
              style={{ "--chip": POWERS[p].color } as React.CSSProperties}
              title={`${POWERS[p].display}${ai ? " (AI)" : ""}${dead ? " — eliminated" : ""}`}
            >
              <span className="tb-dot" />
              {POWERS[p].display}
              {ai && <span className="tb-ai">🤖</span>}
            </span>
          );
        })}
      </div>
      <div className="tb-phases">
        {PHASE_ORDER.map((ph) => (
          <span key={ph} className={`tb-pip${ph === state.phase ? " on" : ""}`} title={labelFor(ph)}>
            {labelFor(ph)}
          </span>
        ))}
      </div>
    </div>
  );
}
