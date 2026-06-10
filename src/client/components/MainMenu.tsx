import React, { useState } from "react";
import type { GameOptions } from "@engine/index";
import { api } from "../api.js";

// The landing screen: start a new game (choosing house rules) or join one by
// code. Designed mobile-first — big tap targets, single-column, fits a phone.

interface Props {
  onEnter: (gameId: string) => void;
}

const DEFAULTS: GameOptions = {
  lowLuck: false,
  nationalObjectives: true,
  research: false,
  victory: { mode: "capitals", cities: 8 },
};

export function MainMenu({ onEnter }: Props) {
  const [opts, setOpts] = useState<GameOptions>(DEFAULTS);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const id = await api.createGame(opts);
      onEnter(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const Toggle = ({ label, hint, on, set }: { label: string; hint: string; on: boolean; set: (v: boolean) => void }) => (
    <button className={`opt ${on ? "on" : ""}`} onClick={() => set(!on)}>
      <span className="opt-check">{on ? "✓" : ""}</span>
      <span>
        <b>{label}</b>
        <div className="hint">{hint}</div>
      </span>
    </button>
  );

  return (
    <div className="center menu-scroll">
      <div className="title">
        Axis <span className="gold">&amp;</span> Allies
      </div>
      <div className="title" style={{ fontSize: 22, marginTop: -10 }}>
        <span className="gold">Global 1940</span>
      </div>
      <div className="subtitle">
        Turn-based play-by-cloud for 2–7 commanders. Each player picks their powers and plays from
        their own phone or laptop.
      </div>

      <div className="card menu-card">
        <div className="section-title">New game — house rules</div>
        <Toggle
          label="Low Luck"
          hint="Convert dice to guaranteed hits + one rounding roll. Less swingy battles."
          on={opts.lowLuck}
          set={(v) => setOpts({ ...opts, lowLuck: v })}
        />
        <Toggle
          label="National Objectives"
          hint="Bonus IPC for holding key territories (Moscow, Egypt, India…)."
          on={opts.nationalObjectives}
          set={(v) => setOpts({ ...opts, nationalObjectives: v })}
        />
        <Toggle
          label="Research & Development"
          hint="Allow spending IPC on technology rolls. (Experimental.)"
          on={opts.research}
          set={(v) => setOpts({ ...opts, research: v })}
        />

        <div className="section-title mt">Victory condition</div>
        <div className="seg">
          <button
            className={opts.victory.mode === "capitals" ? "active" : ""}
            onClick={() => setOpts({ ...opts, victory: { ...opts.victory, mode: "capitals" } })}
          >
            Hold all enemy capitals
          </button>
          <button
            className={opts.victory.mode === "cities" ? "active" : ""}
            onClick={() => setOpts({ ...opts, victory: { ...opts.victory, mode: "cities" } })}
          >
            Victory cities
          </button>
        </div>
        {opts.victory.mode === "cities" && (
          <div className="row mt">
            <span className="hint">Cities to win:</span>
            <input
              type="number"
              min={1}
              max={20}
              value={opts.victory.cities}
              style={{ width: 70 }}
              onChange={(e) => setOpts({ ...opts, victory: { ...opts.victory, cities: Number(e.target.value) } })}
            />
          </div>
        )}

        <button className="gold mt" style={{ width: "100%", padding: "14px" }} disabled={busy} onClick={create}>
          {busy ? "Creating…" : "Create game ▸"}
        </button>
        {error && <div className="hint" style={{ color: "var(--danger)" }}>{error}</div>}
      </div>

      <div className="card menu-card">
        <div className="section-title">Join a game</div>
        <div className="link-box">
          <input placeholder="game code" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="primary" disabled={!code.trim()} onClick={() => onEnter(code.trim())}>
            Join
          </button>
        </div>
      </div>
    </div>
  );
}
