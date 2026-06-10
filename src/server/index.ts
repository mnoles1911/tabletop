import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import type { Action } from "../engine/index.js";
import { applyAction } from "../engine/index.js";
import {
  createGame,
  loadGame,
  saveGame,
  claimSeat,
  powerForToken,
  publicSeats,
} from "./store.js";

// ============================================================================
// Play-by-cloud game server. REST + polling:
//   POST /api/games                  create a game, get a shareable id
//   POST /api/games/:id/join         claim a power, receive a private token
//   GET  /api/games/:id              fetch authoritative state (+ poll)
//   POST /api/games/:id/action       submit an action (server-authoritative)
//
// The server is the single source of truth: it re-runs the deterministic
// engine for every action, bumps the state version, and persists. Clients
// poll GET to stay in sync, so there is no always-on socket to babysit.
// ============================================================================

const app = express();
app.use(express.json({ limit: "1mb" }));

app.post("/api/games", (_req, res) => {
  const game = createGame();
  res.json({ gameId: game.id });
});

app.post("/api/games/:id/join", (req, res) => {
  const game = loadGame(req.params.id);
  if (!game) return res.status(404).json({ error: "Game not found." });
  const { power, name } = req.body ?? {};
  const result = claimSeat(game, power, name);
  if ("error" in result) return res.status(409).json(result);
  res.json({ token: result.token, power, gameId: game.id });
});

app.get("/api/games/:id", (req, res) => {
  const game = loadGame(req.params.id);
  if (!game) return res.status(404).json({ error: "Game not found." });
  const token = String(req.query.token ?? "");
  const you = token ? powerForToken(game, token) : null;
  res.json({
    gameId: game.id,
    state: game.state,
    seats: publicSeats(game),
    you,
  });
});

app.post("/api/games/:id/action", (req, res) => {
  const game = loadGame(req.params.id);
  if (!game) return res.status(404).json({ error: "Game not found." });

  const { token, action, version } = req.body as {
    token: string;
    action: Action;
    version: number;
  };
  const actor = powerForToken(game, token);
  if (!actor) return res.status(401).json({ error: "Take a seat before acting." });

  // Optimistic concurrency: reject actions built against a stale state.
  if (typeof version === "number" && version !== game.state.version) {
    return res.status(409).json({ error: "Game state moved on — refresh.", state: game.state });
  }

  const result = applyAction(game.state, action, actor);
  if (!result.ok) return res.status(400).json({ error: result.error, state: game.state });

  game.state.version += 1;
  saveGame(game);
  res.json({ ok: true, state: game.state, seats: publicSeats(game) });
});

// Serve the built client in production (single-process deploy).
const here = dirname(fileURLToPath(import.meta.url));
const clientDist = resolve(here, "../../dist/client");
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => res.sendFile(resolve(clientDist, "index.html")));
}

const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => {
  console.log(`Axis & Allies server listening on http://localhost:${PORT}`);
});
