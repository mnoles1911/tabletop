import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  checkMove,
  placementOptions,
  TERRITORIES,
  type Action,
  type UnitTypeId,
} from "@engine/index";
import { type GameView } from "./api.js";
import { backend, LOCAL } from "./backend.js";
import {
  recordGame,
  exportSaveFile,
  autoBackupEnabled,
  setAutoBackup,
  loadMirror,
} from "./saves.js";
import { GlobeBoard as Board } from "./components/GlobeBoard.js";
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
  const [autoBackup, setAuto] = useState(autoBackupEnabled());
  const [savedFlash, setSavedFlash] = useState(false);

  // Latest view kept in a ref so the (memoised) refresh can use it for the
  // offline mirror fallback without re-subscribing on every state change.
  const viewRef = useRef<GameView | null>(null);
  viewRef.current = view;
  const lastRoundRef = useRef(0);

  useEffect(() => {
    if (name) localStorage.setItem("aa_name", name);
  }, [name]);

  const refresh = useCallback(async () => {
    if (!gameId) return;
    try {
      const v = await backend.fetchGame(gameId, token);
      setView(v);
    } catch (e) {
      // Disconnect / dropped connection: fall back to the last autosaved board
      // so the player still sees the game while we keep retrying in the back-
      // ground. The server (cloud) remains the source of truth on reconnect.
      if (!viewRef.current && !LOCAL) {
        const mirror = loadMirror(gameId);
        if (mirror) {
          setView({
            gameId,
            started: true,
            options: mirror.options,
            state: mirror,
            seats: [],
            youPowers: [],
            youJoined: true,
          });
          setError("Offline — showing your last saved board. Reconnecting…");
          return;
        }
      }
      setError((e as Error).message);
    }
  }, [gameId, token]);

  // Continuous autosave: record the game in this device's registry (and mirror
  // cloud state) on every update, and auto-download a backup at each new round
  // when the player has opted in.
  useEffect(() => {
    if (!view || !view.started) return;
    recordGame(view, LOCAL ? "local" : "cloud");
    const round = view.state.round;
    if (autoBackup && lastRoundRef.current && round > lastRoundRef.current) {
      exportSaveFile(view);
    }
    lastRoundRef.current = round;
    setSavedFlash(true);
    const t = setTimeout(() => setSavedFlash(false), 1200);
    return () => clearTimeout(t);
  }, [view, autoBackup]);

  const saveToFile = useCallback(() => {
    if (view) exportSaveFile(view);
  }, [view]);

  const toggleAutoBackup = useCallback(() => {
    setAuto((on) => {
      setAutoBackup(!on);
      return !on;
    });
  }, []);

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
        <div className="save-bar">
          <span className={`save-dot ${savedFlash ? "on" : ""}`} title="Autosaved to this browser">
            {savedFlash ? "Saved ✓" : "Autosave on"}
          </span>
          <button onClick={saveToFile} title="Download a .json save you can reload later">💾 Save file</button>
          <button className={autoBackup ? "active" : ""} onClick={toggleAutoBackup} title="Auto-download a backup at the start of each round">
            ⤓ Each round
          </button>
        </div>
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
