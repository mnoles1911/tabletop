# Axis & Allies — Global 1940 (2nd Edition), Online

A turn-based, **play-by-cloud** implementation of *Axis & Allies Global 1940*.
Create a game, share the link, and each of 2–7 commanders plays from their own
device. The server is the single source of truth and re-runs a deterministic
rules engine for every action, so dice are reproducible and nobody can cheat
the state.

> **Status:** playable end-to-end vertical slice. The engine, turn structure,
> economy, movement, and combat are implemented and tested; the map is a
> faithful, fully-connected *seed* of the full board. See **Roadmap** below for
> exactly what is wired vs. still stubbed.

## Quick start (local)

```bash
npm install
npm run dev        # server on :8787, client on :5173 (proxied)
```

Open http://localhost:5173 → **Create game** (pick house rules) → share the link.
Each player opens it, claims one or more powers in the lobby, then anyone hits
**Start**. The board polls every 2.5s to stay in sync.

## Play on your phone

The UI is fully mobile-responsive (pan/pinch-zoom map, a tap-up control sheet,
big touch targets). Three ways to get it onto a phone:

**A. Same Wi-Fi (no accounts, easiest).** On your computer:
```bash
npm run build && npm start      # serves UI + API on :8787, all interfaces
```
Find your computer's LAN IP (`ipconfig` / `ifconfig` / `ip addr` — e.g.
`192.168.1.42`) and open `http://192.168.1.42:8787` on any phone on the same
network. Share that address with friends in the house.

**B. Public URL for remote friends — one-tap deploy (Render).** This repo ships
a `Dockerfile` and `render.yaml`. Push to GitHub → Render → **New > Blueprint**
→ pick the repo. Render builds the image and hands you a public `https://…`
URL that you and friends open from anywhere. (Works the same on Railway, Fly.io,
or Cloud Run via the Dockerfile.)

**C. Your own tunnel.** From your machine (where outbound isn't restricted):
```bash
npm start
npx cloudflared tunnel --url http://localhost:8787   # or: ngrok http 8787
```
and share the printed URL.

## Production / Docker

```bash
docker build -t aa1940 . && docker run -p 8787:8787 -v $PWD/data:/app/data aa1940
# or, without Docker:
npm run build && npm start
```

## Architecture

```
src/
  engine/          deterministic, dependency-free TypeScript rules engine
    data/          units, powers, territories (the game's "rulebook as data")
    rules/         setup, movement, combat, income, phases, actions, rng
  server/          Express + SQLite play-by-cloud rooms (REST + polling)
  client/          React + Vite board UI (SVG map, phase panels)
```

The **same engine** runs on the server (authoritative) and the client
(instant feedback + legal-move highlighting). One reducer — `applyAction(state,
action, actor)` — is the only way the game state ever changes.

### Rules implemented

- **Turn structure:** purchase → combat-move → combat → non-combat-move →
  mobilize → collect-income, cycling through all nine powers in the official
  sequence, advancing the round on wrap.
- **Economy:** IPC treasuries, territory income, the "lose your capital → lose
  your income (and treasury)" rule.
- **Movement:** domain-correct pathfinding (land/sea/air) with movement-point
  budgets, zone-of-control stops, and combat-move vs. non-combat-move rules.
- **Combat:** AA opening fire, submarine surprise strike (negated by enemy
  destroyers), artillery→infantry support, tactical-bomber pairing, two-hit
  capital ships (damage persists between rounds, heals after the battle),
  conquest & capital looting. Play it **round-by-round** (fight on / retreat /
  one-click auto-resolve).
- **House rules:** Low Luck dice, National Objective income, victory by capitals
  *or* by N victory cities — all chosen on the main menu.
- **Lobby:** one player may control several powers, so 2–7 friends fill all nine
  seats; unclaimed powers stay open and co-operatively controllable.
- **Mobilization:** placement gated by industrial complexes and domain.

### Unit & power data

All Attack/Defense/Move/Cost values in `src/engine/data/units.ts` match the
Global 1940 2nd-edition rulebook. The nine powers, alliances, capitals,
turn order, and starting IPC are in `src/engine/data/powers.ts`.

## Roadmap (toward full-rulebook fidelity)

The architecture already holds these; they are data/feature additions, not
rewrites:

1. **Full 150-territory map** — `territories.ts` uses the exact production
   schema; remaining territories + sea zones are data entry.
2. **Interactive casualty selection** (currently auto "lose cheapest first";
   round-by-round fighting + retreat already implemented).
3. **Transports & amphibious assaults** with shore bombardment.
4. **Strategic bombing raids** and industrial-complex damage/repair.
5. **Research & development** tech tree (the toggle is wired; rolls are next).
6. **Scrambling, kamikaze, canals (Suez/Panama), neutral territories.**

National Objectives are implemented (a representative set; extend the table in
`rules/income.ts`).

## Testing

```bash
npm test           # node:test engine suite (determinism, economy, phases)
npm run typecheck
```
