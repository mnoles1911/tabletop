import type { GameState, GameOptions } from "@engine/index";
import type { GameView } from "./api.js";
import { writeLocalGame, readLocalGame, listLocalGameIds } from "./localStore.js";

// ============================================================================
// Save / restore system.
//
// Games must survive across sessions, disconnects and accidentally-closed tabs,
// and players want a real file they can keep and reload later. Three layers:
//
//  1. Continuous autosave to the browser (durable). Local games already live in
//     localStorage; cloud games are mirrored here too, so a refresh or a dropped
//     connection restores the last-known board instantly while we re-sync.
//  2. A device "recent games" registry so the menu can offer Resume.
//  3. Save *files* (.json) you can download on demand or auto-download once per
//     round, then re-import later to continue — others rejoin and play on.
//
// Browsers can't silently write to disk without a click, so "auto-backup each
// round" triggers a normal download; the always-on safety net is the durable
// localStorage autosave, which needs no interaction.
// ============================================================================

const SAVE_KIND = "axis-allies-1940-save";
const SAVE_SCHEMA = 1;

const RECENT_KEY = "aa_recent";
const MIRROR_KEY = (id: string) => `aa_mirror_${id}`;
const AUTOBACKUP_KEY = "aa_autobackup";

export interface SaveFile {
  kind: typeof SAVE_KIND;
  schema: number;
  gameId: string;
  savedAt: number;
  options: GameOptions;
  state: GameState;
}

export interface RecentGame {
  id: string;
  mode: "local" | "cloud";
  round: number;
  phase: string;
  activePower: string;
  updatedAt: number;
}

// --- recent-games registry -------------------------------------------------

export function listRecent(): RecentGame[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? (JSON.parse(raw) as RecentGame[]) : [];
    return arr.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function writeRecent(list: RecentGame[]): void {
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 24)));
}

/** Record (or refresh) a game in the device registry + mirror its latest state. */
export function recordGame(view: GameView, mode: "local" | "cloud"): void {
  const entry: RecentGame = {
    id: view.gameId,
    mode,
    round: view.state.round,
    phase: view.state.phase,
    activePower: view.state.activePower,
    updatedAt: Date.now(),
  };
  const list = listRecent().filter((g) => g.id !== view.gameId);
  list.unshift(entry);
  writeRecent(list);
  // Cloud games: keep a local mirror so a disconnect/refresh restores instantly.
  if (mode === "cloud") {
    try {
      localStorage.setItem(MIRROR_KEY(view.gameId), JSON.stringify(view.state));
    } catch {
      /* storage full — non-fatal */
    }
  }
}

export function removeRecent(id: string): void {
  writeRecent(listRecent().filter((g) => g.id !== id));
  localStorage.removeItem(MIRROR_KEY(id));
}

/** Last-known state for a cloud game (offline fallback while reconnecting). */
export function loadMirror(id: string): GameState | null {
  try {
    const raw = localStorage.getItem(MIRROR_KEY(id));
    return raw ? (JSON.parse(raw) as GameState) : null;
  } catch {
    return null;
  }
}

// --- save files ------------------------------------------------------------

function download(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download the current game as a .json save the player can keep and reload. */
export function exportSaveFile(view: GameView): void {
  const save: SaveFile = {
    kind: SAVE_KIND,
    schema: SAVE_SCHEMA,
    gameId: view.gameId,
    savedAt: Date.now(),
    options: view.state.options,
    state: view.state,
  };
  const name = `axis-allies-1940-${view.gameId}-r${view.state.round}.json`;
  download(name, JSON.stringify(save, null, 0));
}

/** Parse + validate a picked save file. Throws on anything that isn't ours. */
export async function readSaveFile(file: File): Promise<SaveFile> {
  const text = await file.text();
  let data: SaveFile;
  try {
    data = JSON.parse(text) as SaveFile;
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (data.kind !== SAVE_KIND || !data.state || !data.state.territories) {
    throw new Error("That isn't an Axis & Allies 1940 save file.");
  }
  return data;
}

/**
 * Install a save into this device's local store so it can be resumed, then
 * return its game id. If a game with the same id already exists and differs,
 * a fresh id is minted so we never silently clobber an in-progress game.
 */
export function installSave(save: SaveFile): string {
  let id = save.gameId;
  const existing = readLocalGame(id);
  if (existing && existing.version !== save.state.version) {
    id = `${save.gameId}-${Math.random().toString(36).slice(2, 5)}`;
  }
  writeLocalGame(id, save.state);
  return id;
}

// --- auto-backup-each-round preference ------------------------------------

export const autoBackupEnabled = (): boolean =>
  localStorage.getItem(AUTOBACKUP_KEY) === "1";

export const setAutoBackup = (on: boolean): void => {
  localStorage.setItem(AUTOBACKUP_KEY, on ? "1" : "0");
};

/** Ids of games stored locally (for the menu's "continue" fallback scan). */
export const localGameIds = listLocalGameIds;
