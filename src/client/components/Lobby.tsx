import React, { useState } from "react";
import { POWERS, TURN_ORDER, type PowerId } from "@engine/index";
import { api, type GameView } from "../api.js";

// Pre-game lobby. Players join with a name, then claim one or more powers
// (a small group can fill all nine seats). Unclaimed seats stay "open" and are
// co-operatively controllable once play begins. Any joined player can start.

interface Props {
  view: GameView;
  gameId: string;
  token: string | null;
  name: string;
  setName: (n: string) => void;
  onJoined: (token: string) => void;
  refresh: () => void;
}

export function Lobby({ view, gameId, token, name, setName, onJoined, refresh }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shareUrl = `${location.origin}${location.pathname}#g=${gameId}`;
  const youPowers = new Set(view.youPowers);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.join(gameId, name, token);
      onJoined(r.token);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleSeat(power: PowerId, claimed: boolean, mine: boolean) {
    if (!token) return;
    setError(null);
    try {
      if (mine) await api.release(gameId, token, power);
      else if (!claimed) await api.claim(gameId, token, power);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function start() {
    if (!token) return;
    setBusy(true);
    try {
      await api.start(gameId, token);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const alliances: Array<["Axis" | "Allies", PowerId[]]> = [
    ["Axis", TURN_ORDER.filter((p) => POWERS[p].alliance === "Axis")],
    ["Allies", TURN_ORDER.filter((p) => POWERS[p].alliance === "Allies")],
  ];

  return (
    <div className="center menu-scroll">
      <div className="title" style={{ fontSize: 28 }}>
        Game Lobby <span className="gold">·</span> {gameId}
      </div>

      <div className="card menu-card">
        <div className="section-title">Invite friends</div>
        <div className="link-box">
          <input readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
          <button onClick={() => navigator.clipboard?.writeText(shareUrl)}>Copy</button>
        </div>

        {!view.youJoined ? (
          <>
            <div className="section-title mt">Your name</div>
            <div className="link-box">
              <input placeholder="General…" value={name} onChange={(e) => setName(e.target.value)} />
              <button className="primary" disabled={busy} onClick={join}>Join</button>
            </div>
          </>
        ) : (
          <div className="hint mt">
            Joined as <b>{name || "Commander"}</b>. Tap powers below to claim them — you can take
            several. Unclaimed powers are shared by everyone.
          </div>
        )}
      </div>

      {view.youJoined && (
        <div className="card menu-card">
          {alliances.map(([side, powers]) => (
            <div key={side}>
              <div className="section-title">{side}</div>
              {powers.map((p) => {
                const seat = view.seats.find((s) => s.power === p)!;
                const mine = youPowers.has(p);
                return (
                  <button
                    key={p}
                    className={`seat-btn ${mine ? "mine" : seat.claimed ? "taken" : ""}`}
                    disabled={seat.claimed && !mine}
                    onClick={() => toggleSeat(p, seat.claimed, mine)}
                  >
                    <span>
                      <span className="swatch" style={{ background: POWERS[p].color }} />
                      {POWERS[p].display}
                      <span className="hint"> · {POWERS[p].startingIPC} IPC</span>
                    </span>
                    <span className="hint">
                      {mine ? "Yours ✓ (tap to release)" : seat.claimed ? `${seat.name}` : "Open — tap to claim"}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}

          <button className="gold mt" style={{ width: "100%", padding: 14 }} disabled={busy} onClick={start}>
            Start game ▸
          </button>
          <div className="hint mt">Unclaimed powers will be playable by anyone at the table.</div>
        </div>
      )}

      {error && <div className="hint" style={{ color: "var(--danger)" }}>{error}</div>}
    </div>
  );
}
