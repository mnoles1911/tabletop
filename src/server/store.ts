import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { nanoid } from "nanoid";
import type { GameState, PowerId } from "../engine/index.js";
import { createInitialState, TURN_ORDER, POWERS } from "../engine/index.js";

// ============================================================================
// Persistence for play-by-cloud. Each game is a row holding the authoritative
// GameState plus a seat table mapping each power to a player token. Players
// open a shared link, claim a power, and act on their turn. SQLite keeps it
// zero-ops: a single file, no external service to run.
// ============================================================================

export interface Seat {
  power: PowerId;
  name: string | null;
  claimed: boolean;
}

export interface GameRecord {
  id: string;
  state: GameState;
  seats: Record<PowerId, Seat>;
  /** token -> power, used to authorise actions. */
  tokens: Record<string, PowerId>;
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

function emptySeats(): Record<PowerId, Seat> {
  const seats = {} as Record<PowerId, Seat>;
  for (const p of TURN_ORDER) seats[p] = { power: p, name: null, claimed: false };
  return seats;
}

export function createGame(): GameRecord {
  const record: GameRecord = {
    id: nanoid(10),
    state: createInitialState(),
    seats: emptySeats(),
    tokens: {},
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

export function claimSeat(record: GameRecord, power: PowerId, name: string): { token: string } | { error: string } {
  const seat = record.seats[power];
  if (!seat) return { error: "Unknown power." };
  if (seat.claimed) return { error: `${POWERS[power].display} is already taken.` };
  const token = nanoid(16);
  seat.claimed = true;
  seat.name = name || POWERS[power].display;
  record.tokens[token] = power;
  saveGame(record);
  return { token };
}

export function powerForToken(record: GameRecord, token: string): PowerId | null {
  return record.tokens[token] ?? null;
}

/** Public view of seats (never leaks tokens). */
export function publicSeats(record: GameRecord): Seat[] {
  return TURN_ORDER.map((p) => record.seats[p]);
}
