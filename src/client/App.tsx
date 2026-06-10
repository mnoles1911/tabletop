import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  checkMove,
  placementOptions,
  TERRITORIES,
  type Action,
  type PowerId,
  type UnitTypeId,
} from "@engine/index";
import { api, type GameView } from "./api.js";
import { Board } from "./components/Board.js";
import { Sidebar } from "./components/Sidebar.js";
import { Lobby } from "./components/Lobby.js";

// Token persistence: one token per game, keyed in localStorage.
const tokenKey = (gameId: string) => `aa_token_${gameId}`;
const readHashGame = () => new URLSearchParams(location.hash.slice(1)).get("g");

export function App() {
  const [gameId, setGameId] = useState<string | null>(readHashGame());
  const [token, setToken] = useState<string | null>(() => {
    const g = readHashGame();
    return g ? localStorage.getItem(tokenKey(g)) : null;
  });
  const [view, setView] = useState<GameView | null>(null);
  const [spectate, setSpectate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Movement / placement selection state.
  const [selectedTerr, setSelectedTerr] = useState<string | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<UnitTypeId | null>(null);
  const [selectedCount, setSelectedCount] = useState(1);
  const [mobilizeUnit, setMobilizeUnit] = useState<UnitTypeId | null>(null);

  // Poll the authoritative state every few seconds while in a game.
  const refresh = useCallback(async () => {
    if (!gameId) return;
    try {
      const v = await api.fetchGame(gameId, token);
      setView(v);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [gameId, token]);

  useEffect(() => {
    if (!gameId) return;
    refresh();
    const id = setInterval(refresh, 2500);
    return () => clearInterval(id);
  }, [gameId, refresh]);

  const act = useCallback(
    async (action: Action) => {
      if (!gameId || !token || !view) return;
      setBusy(true);
      setError(null);
      try {
        const r = await api.act(gameId, token, action, view.state.version);
        setView({ ...view, state: r.state, seats: r.seats });
        // Clear transient selection after a successful move/place.
        if (action.kind === "move") setSelectedUnit(null);
        if (action.kind === "place") setMobilizeUnit((m) => m); // keep selection for multi-place
      } catch (e) {
        setError((e as Error).message);
        refresh(); // resync on conflict / rejection
      } finally {
        setBusy(false);
      }
    },
    [gameId, token, view, refresh],
  );

  // Compute highlighted targets for the current selection.
  const targets = useMemo(() => {
    const set = new Set<string>();
    if (!view) return set;
    const { state, you } = view;
    if (!you || you !== state.activePower) return set;

    if ((state.phase === "combat_move" || state.phase === "noncombat_move") && selectedTerr && selectedUnit) {
      for (const t of TERRITORIES) {
        if (t.id === selectedTerr) continue;
        const c = checkMove(state, you, { from: selectedTerr, to: t.id, type: selectedUnit, count: selectedCount });
        if (c.ok) set.add(t.id);
      }
    }
    if (state.phase === "mobilize" && mobilizeUnit) {
      for (const id of placementOptions(state, you, mobilizeUnit)) set.add(id);
    }
    return set;
  }, [view, selectedTerr, selectedUnit, selectedCount, mobilizeUnit]);

  const battles = useMemo(() => {
    const set = new Set<string>();
    for (const b of view?.state.combat.battles ?? []) if (!b.resolved) set.add(b.territory);
    return set;
  }, [view]);

  const onPick = useCallback(
    (id: string) => {
      if (!view) return;
      const { state, you } = view;
      const yourTurn = you && you === state.activePower;

      // Mobilize: clicking a valid placement territory places the unit.
      if (yourTurn && state.phase === "mobilize" && mobilizeUnit && targets.has(id)) {
        act({ kind: "place", unit: mobilizeUnit, territory: id });
        return;
      }
      // Movement: clicking a highlighted destination executes the move.
      if (yourTurn && selectedTerr && selectedUnit && targets.has(id)) {
        act({ kind: "move", from: selectedTerr, to: id, unit: selectedUnit, count: selectedCount });
        return;
      }
      // Otherwise select this territory as the movement source.
      setSelectedTerr(id);
      setSelectedUnit(null);
      setSelectedCount(1);
    },
    [view, mobilizeUnit, selectedTerr, selectedUnit, selectedCount, targets, act],
  );

  // --- Render ---------------------------------------------------------------

  // No game yet: landing screen.
  if (!gameId) {
    return (
      <div className="center">
        <div className="title">
          Axis <span className="gold">&amp;</span> Allies — <span className="gold">Global 1940</span>
        </div>
        <div className="subtitle">
          A turn-based, play-by-cloud implementation for 2–7 players. Create a game, share the link,
          and each commander plays from their own device.
        </div>
        <div className="card">
          <button
            className="gold"
            style={{ width: "100%" }}
            onClick={async () => {
              const id = await api.createGame();
              location.hash = `g=${id}`;
              setGameId(id);
            }}
          >
            Create new game
          </button>
          <div className="section-title mt">Or join by code</div>
          <JoinByCode onJoin={(id) => { location.hash = `g=${id}`; setGameId(id); }} />
        </div>
      </div>
    );
  }

  if (!view) return <div className="center"><div className="subtitle">Loading theatre…</div></div>;

  // In a game but no seat claimed yet: show the lobby.
  if (!token && !spectate) {
    return (
      <Lobby
        gameId={gameId}
        seats={view.seats}
        onSpectate={() => setSpectate(true)}
        onJoined={(power: PowerId, tok: string) => {
          localStorage.setItem(tokenKey(gameId), tok);
          setToken(tok);
          refresh();
        }}
      />
    );
  }

  return (
    <div className="app">
      <div className="board-wrap">
        {view.state.winner && <div className="banner">🏆 {view.state.winner} Victory!</div>}
        <Board
          state={view.state}
          selected={selectedTerr}
          targets={targets}
          battles={battles}
          onPick={onPick}
        />
        {error && <div className="error-toast">{error}</div>}
      </div>
      <Sidebar
        view={view}
        selectedTerr={selectedTerr}
        selectedUnit={selectedUnit}
        selectedCount={selectedCount}
        setSelectedUnit={setSelectedUnit}
        setSelectedCount={setSelectedCount}
        mobilizeUnit={mobilizeUnit}
        setMobilizeUnit={setMobilizeUnit}
        act={act}
        busy={busy}
      />
    </div>
  );
}

function JoinByCode({ onJoin }: { onJoin: (id: string) => void }) {
  const [code, setCode] = useState("");
  return (
    <div className="link-box">
      <input placeholder="game code" value={code} onChange={(e) => setCode(e.target.value)} />
      <button className="primary" disabled={!code.trim()} onClick={() => onJoin(code.trim())}>
        Join
      </button>
    </div>
  );
}
