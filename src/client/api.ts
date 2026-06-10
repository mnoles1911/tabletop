import type { Action, GameState, PowerId } from "@engine/index";

// Thin fetch wrapper around the play-by-cloud REST API.

export interface Seat {
  power: PowerId;
  name: string | null;
  claimed: boolean;
}

export interface GameView {
  gameId: string;
  state: GameState;
  seats: Seat[];
  you: PowerId | null;
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  async createGame(): Promise<string> {
    const res = await fetch("/api/games", { method: "POST" });
    return (await json<{ gameId: string }>(res)).gameId;
  },

  async join(gameId: string, power: PowerId, name: string): Promise<{ token: string }> {
    const res = await fetch(`/api/games/${gameId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ power, name }),
    });
    return json<{ token: string }>(res);
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
