import {
  createInitialState,
  applyAction,
  TURN_ORDER,
  DEFAULT_OPTIONS,
  type Action,
  type GameOptions,
  type GameState,
  type PowerId,
} from "@engine/index";
import type { GameView, Seat } from "./api.js";

// ============================================================================
// In-browser game store — the "play on this device" backend used when the app
// is served as a static site (e.g. GitHub Pages) with no game server. It runs
// the exact same deterministic engine the server uses, persisting state to
// localStorage. This is hot-seat / pass-and-play: whoever's turn it is takes
// the device. Same engine, same rules — just no network.
// ============================================================================

const KEY = (id: string) => `aa_local_${id}`;

function load(id: string): GameState | null {
  const raw = localStorage.getItem(KEY(id));
  return raw ? (JSON.parse(raw) as GameState) : null;
}
function save(id: string, state: GameState): void {
  localStorage.setItem(KEY(id), JSON.stringify(state));
}

const seatsAll = (): Seat[] => TURN_ORDER.map((p) => ({ power: p, claimed: true, name: "You" }));

function view(id: string, state: GameState): GameView {
  return {
    gameId: id,
    started: true, // local games skip the lobby — straight to the board
    options: state.options,
    state,
    seats: seatsAll(),
    // Hot-seat: the device always controls whoever is the active power.
    youPowers: [state.activePower] as PowerId[],
    youJoined: true,
  };
}

export const localApi = {
  async createGame(options: Partial<GameOptions>): Promise<string> {
    const id = Math.random().toString(36).slice(2, 8);
    const opts: GameOptions = {
      ...DEFAULT_OPTIONS,
      ...options,
      victory: { ...DEFAULT_OPTIONS.victory, ...options.victory },
    };
    save(id, createInitialState(Date.now() & 0xffffffff, opts));
    return id;
  },

  async join(): Promise<{ token: string; powers: PowerId[] }> {
    return { token: "local", powers: [...TURN_ORDER] };
  },
  async claim(): Promise<{ powers: PowerId[]; seats: Seat[] }> {
    return { powers: [...TURN_ORDER], seats: seatsAll() };
  },
  async release(): Promise<{ powers: PowerId[]; seats: Seat[] }> {
    return { powers: [...TURN_ORDER], seats: seatsAll() };
  },
  async start(): Promise<void> {},

  async fetchGame(id: string): Promise<GameView> {
    const state = load(id);
    if (!state) throw new Error("This game isn't on this device. Start a new one.");
    return view(id, state);
  },

  async act(
    id: string,
    _token: string,
    action: Action,
    _version: number,
  ): Promise<{ state: GameState; seats: Seat[] }> {
    const state = load(id);
    if (!state) throw new Error("Game not found on this device.");
    const result = applyAction(state, action, state.activePower);
    if (!result.ok) throw new Error(result.error ?? "Illegal move.");
    state.version += 1;
    save(id, state);
    return { state, seats: seatsAll() };
  },
};
