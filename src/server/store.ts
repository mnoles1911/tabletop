import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { nanoid } from "nanoid";
import type { GameOptions, GameState, PowerId } from "../engine/index.js";
import { createInitialState, DEFAULT_OPTIONS, TURN_ORDER, POWERS } from "../engine/index.js";

// ============================================================================
// Persistence for play-by-cloud. Each game is one SQLite row holding the
// authoritative GameState plus its lobby: a seat per power and a player roster.
// A single player may control several powers (so 2–7 friends can fill all nine
// seats), and any power left unclaimed is "open" — co-operatively controllable
// by anyone at the table. The game stays in the lobby until a player starts it.
// ============================================================================

export interface Player {
  token: string;
  name: string;
  powers: PowerId[];
}

export interface Seat {
  power: PowerId;
  name: string | null;
  claimed: boolean;
}

export interface GameRecord {
  id: string;
  state: GameState;
  started: boolean;
  options: GameOptions;
  /** power -> token of the controlling player (null = open seat). */
  claims: Record<PowerId, string | null>;
  players: Record<string, Player>;
  createdAt: number;
}

const DB_PATH = process.env.AA_DB ?? "./data/games.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

const insertStmt = db.prepare("INSERT INTO games (id, data, created_at) VALUES (?, ?, ?)");
const selectStmt = db.prepare("SELECT data FROM games WHERE id = ?");
const updateStmt = db.prepare("UPDATE games SET data = ? WHERE id = ?");

function emptyClaims(): Record<PowerId, string | null> {
  const c = {} as Record<PowerId, string | null>;
  for (const p of TURN_ORDER) c[p] = null;
  return c;
}

export function createGame(options: Partial<GameOptions> = {}): GameRecord {
  const opts: GameOptions = { ...DEFAULT_OPTIONS, ...options, victory: { ...DEFAULT_OPTIONS.victory, ...options.victory } };
  const record: GameRecord = {
    id: nanoid(8),
    state: createInitialState(Date.now() & 0xffffffff, opts),
    started: false,
    options: opts,
    claims: emptyClaims(),
    players: {},
    createdAt: Date.now(),
  };
  insertStmt.run(record.id, JSON.stringify(record), record.createdAt);
  return record;
}

export function loadGame(id: string): GameRecord | null {
  const row = selectStmt.get(id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as GameRecord) : null;
}

export function saveGame(record: GameRecord): void {
  updateStmt.run(JSON.stringify(record), record.id);
}

/** Register a player (or return their existing seat list for a known token). */
export function joinPlayer(record: GameRecord, name: string, token?: string): Player {
  if (token && record.players[token]) return record.players[token];
  const tok = nanoid(20);
  record.players[tok] = { token: tok, name: name?.trim() || "Commander", powers: [] };
  saveGame(record);
  return record.players[tok];
}

export function claimSeat(record: GameRecord, token: string, power: PowerId): { ok: true } | { error: string } {
  const player = record.players[token];
  if (!player) return { error: "Join the game first." };
  if (record.started) return { error: "The game has already started." };
  const current = record.claims[power];
  if (current && current !== token) return { error: `${POWERS[power].display} is taken.` };
  record.claims[power] = token;
  if (!player.powers.includes(power)) player.powers.push(power);
  saveGame(record);
  return { ok: true };
}

export function releaseSeat(record: GameRecord, token: string, power: PowerId): void {
  if (record.claims[power] === token) record.claims[power] = null;
  const player = record.players[token];
  if (player) player.powers = player.powers.filter((p) => p !== power);
  saveGame(record);
}

export function startGame(record: GameRecord, token: string): { ok: true } | { error: string } {
  if (!record.players[token]) return { error: "Join the game first." };
  if (record.started) return { error: "Already started." };
  record.started = true;
  saveGame(record);
  return { ok: true };
}

/** A token may act for a power it claimed, or for any open (unclaimed) seat. */
export function canActFor(record: GameRecord, token: string, power: PowerId): boolean {
  if (!record.players[token]) return false;
  const claim = record.claims[power];
  return claim === token || claim === null;
}

export function powersForToken(record: GameRecord, token: string): PowerId[] {
  return record.players[token]?.powers ?? [];
}

/** Public seat view — never leaks tokens. */
export function publicSeats(record: GameRecord): Seat[] {
  return TURN_ORDER.map((p) => {
    const claim = record.claims[p];
    return { power: p, claimed: !!claim, name: claim ? record.players[claim]?.name ?? null : null };
  });
}
