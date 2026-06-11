import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  checkMove,
  placementOptions,
  TERRITORIES,
  TERRITORY_INDEX,
  POWERS,
  UNITS,
  isSea,
  neighbours,
  areEnemies,
  KAMIKAZE_ISLANDS,
  type Action,
  type PowerId,
  type UnitTypeId,
} from "@engine/index";
import { type GameView } from "./api.js";
import { backend, LOCAL } from "./backend.js";
import { DiceTray } from "./components/DiceTray.js";
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
  // The most recent move, handed to the globe so it can animate the units
  // travelling from origin to destination (land slide / sea sail / air arc).
  const [lastMove, setLastMove] = useState<
    { from: string; to: string; type: UnitTypeId; owner: string; nonce: number } | null
  >(null);
  // Hover intelligence: previewing a unit's reach, and a province info HUD.
  const [hoverUnit, setHoverUnit] = useState<{ territory: string; type: UnitTypeId } | null>(null);
  const [hoverTerr, setHoverTerr] = useState<string | null>(null);
  const [dice, setDice] = useState<{ atk: number[]; def: number[]; territory: string; nonce: number } | null>(null);
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
        const mover = view.state.activePower;
        const r = await backend.act(gameId, token, action, view.state.version);
        setView({ ...view, state: r.state, seats: r.seats });
        if (action.kind === "move") {
          setSelectedUnit(null);
          setLastMove({ from: action.from, to: action.to, type: action.unit, owner: mover, nonce: Date.now() });
        }
        // Feed the 3D dice tray when a combat round is fought.
        if (action.kind === "battle_round") {
          const b = r.state.combat.battles.find((x) => x.territory === action.territory);
          if (b?.lastRound && (b.lastRound.attackerRolls.length || b.lastRound.defenderRolls.length)) {
            setDice({ atk: b.lastRound.attackerRolls, def: b.lastRound.defenderRolls, territory: action.territory, nonce: Date.now() });
          }
        }
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

  // Range preview: hovering a unit highlights everywhere it could move/attack.
  const rangeTargets = useMemo(() => {
    const set = new Set<string>();
    if (!view || !hoverUnit) return set;
    const { state } = view;
    if (state.phase !== "combat_move" && state.phase !== "noncombat_move") return set;
    for (const t of TERRITORIES) {
      if (t.id === hoverUnit.territory) continue;
      if (checkMove(state, state.activePower, { from: hoverUnit.territory, to: t.id, type: hoverUnit.type, count: 1 }).ok) {
        set.add(t.id);
      }
    }
    return set;
  }, [view, hoverUnit]);

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
        <Board state={view.state} selected={selectedTerr} targets={targets} range={rangeTargets} battles={battles} onPick={onPick} onHoverTerr={setHoverTerr} lastMove={lastMove} />
        {hoverTerr && <TerrHud state={view.state} id={hoverTerr} />}
        <DiceTray event={dice} />
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
        setHoverUnit={setHoverUnit}
        act={act}
        busy={busy}
      />
    </div>
  );
}

/** A small hover HUD: a province's controller, value and force breakdown. */
function TerrHud({ state, id }: { state: GameView["state"]; id: string }) {
  const def = TERRITORY_INDEX[id];
  if (!def) return null;
  const ts = state.territories[id];
  const ctrl = ts?.controller;
  // Special-rule flags for sea zones.
  const kamiZone = isSea(id) && (state.kamikaze ?? 0) > 0 &&
    neighbours(id).some((n) => KAMIKAZE_ISLANDS.has(n) && state.territories[n]?.controller === "Japan");
  const warOwners = new Set((ts?.units ?? []).filter((u) => ["destroyer", "cruiser", "battleship", "aircraft_carrier", "submarine"].includes(u.type)).map((u) => u.owner));
  const convoyZone = isSea(id) && warOwners.size > 0 && neighbours(id).some((n) => {
    const lt = state.territories[n]; const d = TERRITORY_INDEX[n];
    return !isSea(n) && lt?.controller && d && d.ipc > 0 && [...warOwners].some((o) => areEnemies(o, lt.controller!));
  });
  const groups = new Map<string, number>();
  for (const u of ts?.units ?? []) {
    const key = `${u.owner}:${u.type}`;
    groups.set(key, (groups.get(key) ?? 0) + u.count);
  }
  return (
    <div className="terr-hud">
      <div className="terr-hud-title">
        {def.victoryCity ? "★ " : ""}{def.display}
        {def.ipc > 0 && <span className="terr-hud-ipc"> {def.ipc} IPC</span>}
      </div>
      <div className="hint">
        {isSea(id) ? "Sea zone" : ctrl ? <>Controlled by <b style={{ color: POWERS[ctrl].color }}>{POWERS[ctrl].display}</b></> : "Unoccupied / neutral"}
      </div>
      {kamiZone && <div className="hint" style={{ color: "#e7b24a" }}>🎌 Kamikaze zone — Japan: {state.kamikaze} token(s)</div>}
      {convoyZone && <div className="hint" style={{ color: "var(--danger)" }}>⚠️ Convoy raid — enemy warships disrupting income</div>}
      {groups.size === 0 ? (
        <div className="hint">No forces present.</div>
      ) : (
        <div className="terr-hud-units">
          {[...groups.entries()].map(([key, n]) => {
            const [owner, type] = key.split(":") as [PowerId, UnitTypeId];
            return (
              <div key={key} className="terr-hud-row">
                <span className="swatch" style={{ background: POWERS[owner].color }} />
                {n}× {UNITS[type].display}
                <span className="terr-hud-adm">⚔{UNITS[type].attack} 🛡{UNITS[type].defense} 🚶{UNITS[type].movement}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
