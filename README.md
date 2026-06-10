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

## Quick start

```bash
npm install
npm run dev        # server on :8787, client on :5173 (proxied)
```

Open http://localhost:5173 → **Create new game** → copy the share link to your
friends. Each player opens the link, claims a power, and plays on their turn.
The board polls the server every 2.5s to stay in sync.

Production (single process serving the built client):

```bash
npm run build
npm start          # serves UI + API on :8787
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
  capital ships, deterministic round resolution, conquest & capital looting.
- **Mobilization:** placement gated by industrial complexes and domain.
- **Victory:** alliance holds all enemy capitals.

### Unit & power data

All Attack/Defense/Move/Cost values in `src/engine/data/units.ts` match the
Global 1940 2nd-edition rulebook. The nine powers, alliances, capitals,
turn order, and starting IPC are in `src/engine/data/powers.ts`.

## Roadmap (toward full-rulebook fidelity)

The architecture already holds these; they are data/feature additions, not
rewrites:

1. **Full 150-territory map** — `territories.ts` uses the exact production
   schema; remaining territories + sea zones are data entry.
2. **Interactive casualty selection** (currently auto "lose cheapest first").
3. **Transports & amphibious assaults** with shore bombardment.
4. **Strategic bombing raids** and industrial-complex damage/repair.
5. **National Objectives** and the **research & development** tech tree.
6. **Scrambling, kamikaze, canals (Suez/Panama), neutral territories.**

## Testing

```bash
npm test           # node:test engine suite (determinism, economy, phases)
npm run typecheck
```
