import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  checkMove,
  placementOptions,
  TERRITORIES,
  type Action,
  type UnitTypeId,
} from "@engine/index";
import { type GameView } from "./api.js";
import { backend, LOCAL } from "./backend.js";
import { Board } from "./components/Board.js";
import { Sidebar } from "./components/Sidebar.js";
import { Lobby } from "./components/Lobby.js";
import { MainMenu } from "./components/MainMenu.js";

const tokenKey = (gameId: string) => `aa_token_${gameId}`;
const readHashGame = () => new URLSearchParams(location.hash.slice(1)).get("g");

export function App() {
  const [gameId, setGameId] = useState<string | null>(readHashGame());
  const [token, setToken] = useState<string | null>(() => {
    if (LOCAL) return "local";
    const g = readHashGame();
    return g ? localStorage.getItem(tokenKey(g)) : null;
  });
  const [name, setName] = useState(() => localStorage.getItem("aa_name") ?? "");
  const [view, setView] = useState<GameView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [selectedTerr, setSelectedTerr] = useState<string | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<UnitTypeId | null>(null);
  const [selectedCount, setSelectedCount] = useState(1);
  const [mobilizeUnit, setMobilizeUnit] = useState<UnitTypeId | null>(null);
  const [sheetOpen, setSheetOpen] = useState(true); // mobile bottom sheet

  useEffect(() => {
    if (name) localStorage.setItem("aa_name", name);
  }, [name]);

  const refresh = useCallback(async () => {
    if (!gameId) return;
    try {
      const v = await backend.fetchGame(gameId, token);
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

  // Whether the local player may act for the currently active power.
  const canAct = useMemo(() => {
    if (!view || !view.started || !token || view.state.winner) return false;
    const active = view.state.activePower;
    if (view.youPowers.includes(active)) return true;
    const seat = view.seats.find((s) => s.power === active);
    return !!seat && !seat.claimed; // open seats are co-operatively controllable
  }, [view, token]);

  const act = useCallback(
    async (action: Action) => {
      if (!gameId || !token || !view) return;
      setBusy(true);
      setError(null);
      try {
        const r = await backend.act(gameId, token, action, view.state.version);
        setView({ ...view, state: r.state, seats: r.seats });
        if (action.kind === "move") setSelectedUnit(null);
      } catch (e) {
        setError((e as Error).message);
        refresh();
      } finally {
        setBusy(false);
      }
    },
    [gameId, token, view, refresh],
  );

  const targets = useMemo(() => {
    const set = new Set<string>();
    if (!view || !canAct) return set;
    const { state } = view;
    const active = state.activePower;
    if ((state.phase === "combat_move" || state.phase === "noncombat_move") && selectedTerr && selectedUnit) {
      for (const t of TERRITORIES) {
        if (t.id === selectedTerr) continue;
        if (checkMove(state, active, { from: selectedTerr, to: t.id, type: selectedUnit, count: selectedCount }).ok) {
          set.add(t.id);
        }
      }
    }
    if (state.phase === "mobilize" && mobilizeUnit) {
      for (const id of placementOptions(state, active, mobilizeUnit)) set.add(id);
    }
    return set;
  }, [view, canAct, selectedTerr, selectedUnit, selectedCount, mobilizeUnit]);

  const battles = useMemo(() => {
    const set = new Set<string>();
    for (const b of view?.state.combat.battles ?? []) if (!b.resolved) set.add(b.territory);
    return set;
  }, [view]);

  const onPick = useCallback(
    (id: string) => {
      if (!view) return;
      const { state } = view;
      if (canAct && state.phase === "mobilize" && mobilizeUnit && targets.has(id)) {
        act({ kind: "place", unit: mobilizeUnit, territory: id });
        return;
      }
      if (canAct && selectedTerr && selectedUnit && targets.has(id)) {
        act({ kind: "move", from: selectedTerr, to: id, unit: selectedUnit, count: selectedCount });
        return;
      }
      setSelectedTerr(id);
      setSelectedUnit(null);
      setSelectedCount(1);
      setSheetOpen(true);
    },
    [view, canAct, mobilizeUnit, selectedTerr, selectedUnit, selectedCount, targets, act],
  );

  // --- Render ---------------------------------------------------------------

  if (!gameId) {
    return (
      <MainMenu
        onEnter={(id) => {
          location.hash = `g=${id}`;
          setToken(LOCAL ? "local" : localStorage.getItem(tokenKey(id)));
          setGameId(id);
        }}
      />
    );
  }

  if (!view) return <div className="center"><div className="subtitle">Loading theatre…</div></div>;

  if (!view.started) {
    return (
      <Lobby
        view={view}
        gameId={gameId}
        token={token}
        name={name}
        setName={setName}
        refresh={refresh}
        onJoined={(tok) => {
          localStorage.setItem(tokenKey(gameId), tok);
          setToken(tok);
          refresh();
        }}
      />
    );
  }

  return (
    <div className={`app ${sheetOpen ? "sheet-open" : ""}`}>
      <div className="board-wrap">
        {view.state.winner && <div className="banner">🏆 {view.state.winner} Victory!</div>}
        <Board state={view.state} selected={selectedTerr} targets={targets} battles={battles} onPick={onPick} />
        {error && <div className="error-toast" onClick={() => setError(null)}>{error}</div>}
        <button className="sheet-toggle" onClick={() => setSheetOpen((s) => !s)}>
          {sheetOpen ? "▾ Hide panel" : "▴ Show controls"}
        </button>
      </div>
      <Sidebar
        view={view}
        canAct={canAct}
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
