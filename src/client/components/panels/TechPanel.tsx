import React, { useState } from "react";
import { ALL_TECHS, TECH_NAMES, RESEARCH_DIE_COST, type Action, type GameState, type PowerId } from "@engine/index";
import type { PanelProps } from "./types.js";

// Research & Development phase: spend IPC on technology rolls.

export function TechPanel({ view, act, busy, actingAs }: PanelProps) {
  const { state } = view;
  const active = actingAs ?? state.activePower;
  return (
    <div>
      <ResearchControls state={state} active={active} act={act} busy={busy} />
    </div>
  );
}

function ResearchControls({ state, active, act, busy }: { state: GameState; active: PowerId; act: (a: Action) => void; busy: boolean }) {
  const [dice, setDice] = useState(1);
  const owned = new Set(state.tech[active] ?? []);
  const cost = dice * RESEARCH_DIE_COST;
  return (
    <div>
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
