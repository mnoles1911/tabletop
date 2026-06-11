import React, { useState } from "react";
import {
  POWERS,
  TURN_ORDER,
  availableDeclarations,
  atWar,
  sameAlliance,
  WAR_BLOC,
  type GameState,
  type PowerId,
} from "@engine/index";
import type { PanelProps } from "./types.js";

// Politics phase: declare war on the powers the active power may legally attack,
// with a confirm step, plus a compact who-is-at-war-with-whom summary.

export function PoliticsPanel({ view, act, busy, actingAs }: PanelProps) {
  const { state } = view;
  const active = actingAs ?? state.activePower;
  const targets = availableDeclarations(state, active);
  const [confirm, setConfirm] = useState<PowerId | null>(null);

  return (
    <div>
      <div className="section-title">Declarations of war</div>
      {targets.length === 0 ? (
        <div className="hint">No declarations available this turn.</div>
      ) : (
        targets.map((t) => {
          const bloc = WAR_BLOC.includes(t);
          const pending = confirm === t;
          return (
            <div className="war-decl" key={t}>
              <div className="spread">
                <span>
                  <span className="swatch" style={{ background: POWERS[t].color }} />
                  Declare war on <b>{POWERS[t].display}</b>
                </span>
                {pending ? (
                  <span className="row">
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => { act({ kind: "declare_war", target: t }); setConfirm(null); }}
                    >
                      Confirm
                    </button>
                    <button disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
                  </span>
                ) : (
                  <button className="danger-btn" disabled={busy} onClick={() => setConfirm(t)}>Declare ⚔</button>
                )}
              </div>
              {bloc && (
                <div className="hint">Brings the United Kingdom, ANZAC and France into the war together.</div>
              )}
            </div>
          );
        })
      )}

      <RelationsSummary state={state} active={active} />
    </div>
  );
}

/** For each enemy-able pair involving the active power, show war vs peace. */
function RelationsSummary({ state, active }: { state: GameState; active: PowerId }) {
  const others = TURN_ORDER.filter((p) => p !== active && !sameAlliance(p, active));
  if (others.length === 0) return null;
  return (
    <div className="mt">
      <div className="section-title">Your relations</div>
      <div className="relations">
        {others.map((p) => {
          const war = atWar(state, active, p);
          return (
            <div key={p} className="rel-row">
              <span>
                <span className="swatch" style={{ background: POWERS[p].color }} />
                {POWERS[p].display}
              </span>
              <span className={war ? "rel-war" : "rel-peace"}>{war ? "⚔ At war" : "At peace"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
