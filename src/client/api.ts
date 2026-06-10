import type { Action, GameOptions, GameState, PowerId } from "@engine/index";

// Thin fetch wrapper around the play-by-cloud REST API.

export interface Seat {
  power: PowerId;
  name: string | null;
  claimed: boolean;
}

export interface GameView {
  gameId: string;
  started: boolean;
  options: GameOptions;
  state: GameState;
  seats: Seat[];
  youPowers: PowerId[];
  youJoined: boolean;
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  async createGame(options: Partial<GameOptions>): Promise<string> {
    const res = await fetch("/api/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ options }),
    });
    return (await json<{ gameId: string }>(res)).gameId;
  },

  async join(gameId: string, name: string, token: string | null): Promise<{ token: string; powers: PowerId[] }> {
    const res = await fetch(`/api/games/${gameId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, token }),
    });
    return json<{ token: string; powers: PowerId[] }>(res);
  },

  async claim(gameId: string, token: string, power: PowerId): Promise<{ powers: PowerId[]; seats: Seat[] }> {
    const res = await fetch(`/api/games/${gameId}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, power }),
    });
    return json<{ powers: PowerId[]; seats: Seat[] }>(res);
  },

  async release(gameId: string, token: string, power: PowerId): Promise<{ powers: PowerId[]; seats: Seat[] }> {
    const res = await fetch(`/api/games/${gameId}/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, power }),
    });
    return json<{ powers: PowerId[]; seats: Seat[] }>(res);
  },

  async start(gameId: string, token: string): Promise<void> {
    const res = await fetch(`/api/games/${gameId}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    await json(res);
  },

  async fetchGame(gameId: string, token: string | null): Promise<GameView> {
    const q = token ? `?token=${encodeURIComponent(token)}` : "";
    const res = await fetch(`/api/games/${gameId}${q}`);
    return json<GameView>(res);
  },

  async act(
    gameId: string,
    token: string,
    action: Action,
    version: number,
  ): Promise<{ state: GameState; seats: Seat[] }> {
    const res = await fetch(`/api/games/${gameId}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, action, version }),
    });
    return json<{ state: GameState; seats: Seat[] }>(res);
  },
};
