import React, { useState } from "react";
import { POWERS, TURN_ORDER, type PowerId } from "@engine/index";
import { api, type Seat } from "../api.js";

interface Props {
  gameId: string;
  seats: Seat[];
  onJoined: (power: PowerId, token: string) => void;
  onSpectate: () => void;
}

export function Lobby({ gameId, seats, onJoined, onSpectate }: Props) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState<PowerId | null>(null);
  const shareUrl = `${location.origin}${location.pathname}#g=${gameId}`;

  async function take(power: PowerId) {
    setError(null);
    setJoining(power);
    try {
      const { token } = await api.join(gameId, power, name.trim());
      onJoined(power, token);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setJoining(null);
    }
  }

  return (
    <div className="center">
      <div className="title">
        Axis <span className="gold">&amp;</span> Allies — <span className="gold">Global 1940</span>
      </div>
      <div className="card">
        <div className="section-title">Share this link with your friends</div>
        <div className="link-box">
          <input readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
          <button onClick={() => navigator.clipboard?.writeText(shareUrl)}>Copy</button>
        </div>

        <div className="section-title mt">Your name</div>
        <input
          style={{ width: "100%" }}
          placeholder="General…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div className="section-title mt">Choose a power</div>
        {TURN_ORDER.map((p) => {
          const seat = seats.find((s) => s.power === p);
          return (
            <div className="seat-row" key={p}>
              <span>
                <span className="swatch" style={{ background: POWERS[p].color }} />
                {POWERS[p].display}{" "}
                <span className="hint">
                  ({POWERS[p].alliance}, {POWERS[p].startingIPC} IPC)
                </span>
              </span>
              {seat?.claimed ? (
                <span className="hint">Taken{seat.name ? ` — ${seat.name}` : ""}</span>
              ) : (
                <button className="primary" disabled={joining !== null} onClick={() => take(p)}>
                  {joining === p ? "Joining…" : "Take seat"}
                </button>
              )}
            </div>
          );
        })}

        {error && <div className="error-toast" style={{ position: "static", marginTop: 12 }}>{error}</div>}
        <button className="mt" style={{ width: "100%" }} onClick={onSpectate}>
          Just watch (spectate)
        </button>
      </div>
    </div>
  );
}
