import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import type { Action, GameOptions, PowerId } from "../engine/index.js";
import { applyAction, expectedActor } from "../engine/index.js";
import { stepAi } from "./aiRunner.js";
import {
  createGame,
  loadGame,
  saveGame,
  joinPlayer,
  claimSeat,
  releaseSeat,
  startGame,
  canActFor,
  powersForToken,
  publicSeats,
} from "./store.js";

// ============================================================================
// Play-by-cloud game server. REST + polling, server-authoritative:
//   POST /api/games                  create a game (with house-rule options)
//   POST /api/games/:id/join         register a player, get a private token
//   POST /api/games/:id/claim        claim a power (one player may hold several)
//   POST /api/games/:id/release      give a power back to the open pool
//   POST /api/games/:id/start        leave the lobby and begin play
//   GET  /api/games/:id              fetch lobby + authoritative state (poll)
//   POST /api/games/:id/action       submit a game action
// ============================================================================

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.post("/api/games", (req, res) => {
  const options = (req.body?.options ?? {}) as Partial<GameOptions>;
  const game = createGame(options);
  res.json({ gameId: game.id });
});

app.post("/api/games/:id/join", (req, res) => {
  const game = loadGame(req.params.id);
  if (!game) return res.status(404).json({ error: "Game not found." });
  const { name, token } = req.body ?? {};
  const player = joinPlayer(game, name, token);
  res.json({ token: player.token, powers: player.powers });
});

app.post("/api/games/:id/claim", (req, res) => {
  const game = loadGame(req.params.id);
  if (!game) return res.status(404).json({ error: "Game not found." });
  const { token, power } = req.body as { token: string; power: PowerId };
  const result = claimSeat(game, token, power);
  if ("error" in result) return res.status(409).json(result);
  res.json({ ok: true, powers: powersForToken(game, token), seats: publicSeats(game) });
});

app.post("/api/games/:id/release", (req, res) => {
  const game = loadGame(req.params.id);
  if (!game) return res.status(404).json({ error: "Game not found." });
  const { token, power } = req.body as { token: string; power: PowerId };
  releaseSeat(game, token, power);
  res.json({ ok: true, powers: powersForToken(game, token), seats: publicSeats(game) });
});

app.post("/api/games/:id/start", (req, res) => {
  const game = loadGame(req.params.id);
  if (!game) return res.status(404).json({ error: "Game not found." });
  const result = startGame(game, req.body?.token);
  if ("error" in result) return res.status(409).json(result);
  res.json({ ok: true });
});

app.get("/api/games/:id", (req, res) => {
  const game = loadGame(req.params.id);
  if (!game) return res.status(404).json({ error: "Game not found." });
  // Polling drives AI play (including all-AI spectator games).
  stepAi(game);
  const token = String(req.query.token ?? "");
  res.json({
    gameId: game.id,
    started: game.started,
    options: game.options,
    state: game.state,
    seats: publicSeats(game),
    youPowers: token ? powersForToken(game, token) : [],
    youJoined: token ? !!game.players[token] : false,
  });
});

app.post("/api/games/:id/action", (req, res) => {
  const game = loadGame(req.params.id);
  if (!game) return res.status(404).json({ error: "Game not found." });
  if (!game.started) return res.status(409).json({ error: "The game has not started yet." });

  const { token, action, version, as } = req.body as { token: string; action: Action; version: number; as?: PowerId };
  if (!game.players[token]) return res.status(401).json({ error: "Join the game before acting." });
  // Normal actions act as the active power; `as` lets a defending player
  // answer battle prompts (casualties / scramble) during another's turn.
  const actor = as ?? game.state.activePower;
  if (!canActFor(game, token, actor)) {
    return res.status(403).json({ error: "That power isn't yours to move." });
  }
  if (actor !== game.state.activePower && actor !== expectedActor(game.state)) {
    return res.status(409).json({ error: "The game isn't waiting on that power." });
  }
  if (typeof version === "number" && version !== game.state.version) {
    return res.status(409).json({ error: "Game state moved on — refresh.", state: game.state });
  }

  const result = applyAction(game.state, action, actor);
  if (!result.ok) return res.status(400).json({ error: result.error, state: game.state });

  game.state.version += 1;
  saveGame(game);
  // Hand the floor to the AI before responding (bounded; polling resumes it).
  stepAi(game);
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
