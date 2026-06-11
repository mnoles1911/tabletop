import {
  createInitialState,
  applyAction,
  expectedActor,
  migrateState,
  TURN_ORDER,
  DEFAULT_OPTIONS,
  type Action,
  type GameOptions,
  type GameState,
  type PowerId,
} from "@engine/index";
import { nextAiAction, isAi } from "@engine/ai/index";
import type { GameView, Seat } from "./api.js";

// ============================================================================
// In-browser game store — the "play on this device" backend used when the app
// is served as a static site (e.g. GitHub Pages) with no game server. It runs
// the exact same deterministic engine the server uses, persisting state to
// localStorage. Hot-seat / pass-and-play: every HUMAN power is controlled from
// this device; AI powers play themselves between your moves and on each poll.
// ============================================================================

const KEY = (id: string) => `aa_local_${id}`;

function load(id: string): GameState | null {
  const raw = localStorage.getItem(KEY(id));
  return raw ? migrateState(JSON.parse(raw)) : null;
}

/** Let AI powers play (bounded; the UI's poll loop resumes long AI stretches). */
function runAi(state: GameState): void {
  for (let i = 0; i < 100; i++) {
    if (state.winner) return;
    const actor = expectedActor(state);
    if (!isAi(state, actor)) return;
    const action = nextAiAction(state);
    if (!action) return;
    applyAction(state, action, actor);
    state.version += 1;
  }
}
function save(id: string, state: GameState): void {
  localStorage.setItem(KEY(id), JSON.stringify(state));
}

// --- Shared helpers used by the save/restore system ----------------------
/** Read a locally-stored game's state, or null if it isn't on this device. */
export const readLocalGame = (id: string): GameState | null => load(id);
/** Write/overwrite a locally-stored game (used to install an imported save). */
export const writeLocalGame = (id: string, state: GameState): void => save(id, state);
/** True if a game with this id is stored on this device. */
export const hasLocalGame = (id: string): boolean =>
  localStorage.getItem(KEY(id)) !== null;
/** All game ids currently stored on this device. */
export const listLocalGameIds = (): string[] =>
  Object.keys(localStorage)
    .filter((k) => k.startsWith("aa_local_"))
    .map((k) => k.slice("aa_local_".length));

const seats = (state: GameState): Seat[] =>
  TURN_ORDER.map((p) => ({
    power: p,
    claimed: state.powerControl?.[p] === "human",
    name: state.powerControl?.[p] === "human" ? "You" : "AI",
    control: state.powerControl?.[p] ?? "human",
  }));

const humanPowers = (state: GameState): PowerId[] =>
  TURN_ORDER.filter((p) => state.powerControl?.[p] !== "ai");

function view(id: string, state: GameState): GameView {
  return {
    gameId: id,
    started: true, // local games skip the lobby — straight to the board
    options: state.options,
    state,
    seats: seats(state),
    // Hot-seat: this device controls every human power.
    youPowers: humanPowers(state),
    youJoined: true,
  };
}

export const localApi = {
  async createGame(options: Partial<GameOptions>, humans?: PowerId[]): Promise<string> {
    const id = Math.random().toString(36).slice(2, 8);
    const opts: GameOptions = {
      ...DEFAULT_OPTIONS,
      ...options,
      victory: { ...DEFAULT_OPTIONS.victory, ...options.victory },
    };
    const state = createInitialState(Date.now() & 0xffffffff, opts);
    // Side assignment: listed powers are humans on this device, the rest are
    // AI. Omitted -> classic all-human hot-seat.
    if (humans) {
      for (const p of TURN_ORDER) state.powerControl[p] = humans.includes(p) ? "human" : "ai";
    }
    save(id, state);
    return id;
  },

  async join(): Promise<{ token: string; powers: PowerId[] }> {
    return { token: "local", powers: [...TURN_ORDER] };
  },
  // Local games have no lobby; claim/release are no-ops over an empty view.
  async claim(): Promise<{ powers: PowerId[]; seats: Seat[] }> {
    return { powers: [...TURN_ORDER], seats: [] };
  },
  async release(): Promise<{ powers: PowerId[]; seats: Seat[] }> {
    return { powers: [...TURN_ORDER], seats: [] };
  },
  async start(): Promise<void> {},

  async fetchGame(id: string): Promise<GameView> {
    const state = load(id);
    if (!state) throw new Error("This game isn't on this device. Start a new one.");
    runAi(state);
    save(id, state);
    return view(id, state);
  },

  async act(
    id: string,
    _token: string,
    action: Action,
    _version: number,
    as?: PowerId,
  ): Promise<{ state: GameState; seats: Seat[] }> {
    const state = load(id);
    if (!state) throw new Error("Game not found on this device.");
    const result = applyAction(state, action, as ?? state.activePower);
    if (!result.ok) throw new Error(result.error ?? "Illegal move.");
    state.version += 1;
    runAi(state);
    save(id, state);
    return { state, seats: seats(state) };
  },
};
