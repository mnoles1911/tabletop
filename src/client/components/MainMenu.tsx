import React, { useRef, useState } from "react";
import type { GameOptions } from "@engine/index";
import { backend, LOCAL } from "../backend.js";
import {
  listRecent,
  removeRecent,
  readSaveFile,
  installSave,
  type RecentGame,
} from "../saves.js";

// The landing screen: start a new game (choosing house rules), resume a game
// saved on this device, load a save file, or join one by code. Designed
// mobile-first — big tap targets, single-column, fits a phone.

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
  const [recent, setRecent] = useState<RecentGame[]>(() => listRecent());
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadFile(file: File) {
    setError(null);
    try {
      const save = await readSaveFile(file);
      const id = installSave(save);
      onEnter(id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function forget(id: string) {
    removeRecent(id);
    setRecent(listRecent());
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const id = await backend.createGame(opts);
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
        {LOCAL
          ? "Pass-and-play on this device — set the house rules, then take turns as each power. Your game is saved in this browser."
          : "Turn-based play-by-cloud for 2–7 commanders. Each player picks their powers and plays from their own phone or laptop."}
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

      {(recent.length > 0 || LOCAL) && (
        <div className="card menu-card">
          <div className="section-title">Continue a game</div>
          {recent.length === 0 && (
            <div className="hint">No saved games on this device yet. Your games autosave here as you play.</div>
          )}
          {recent.map((g) => (
            <div className="seat-row" key={g.id}>
              <span>
                <b>{g.id}</b>
                <div className="hint">
                  Round {g.round} · {g.phase.replace(/_/g, " ")} · {g.activePower}
                  {g.mode === "cloud" ? " · cloud" : ""}
                </div>
              </span>
              <span className="row">
                <button className="primary" onClick={() => onEnter(g.id)}>Resume</button>
                <button onClick={() => forget(g.id)} title="Remove from this list">✕</button>
              </span>
            </div>
          ))}
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadFile(f);
              e.target.value = "";
            }}
          />
          <button className="mt" style={{ width: "100%" }} onClick={() => fileRef.current?.click()}>
            📂 Load save file…
          </button>
        </div>
      )}

      {!LOCAL && (
        <div className="card menu-card">
          <div className="section-title">Join a game</div>
          <div className="link-box">
            <input placeholder="game code" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="primary" disabled={!code.trim()} onClick={() => onEnter(code.trim())}>
              Join
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
