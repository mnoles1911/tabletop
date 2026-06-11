# CLAUDE.md — axis-allies-1940 (tabletop)

Self-contained TypeScript project (this repo).

## What it is

Online play-by-cloud implementation of *Axis & Allies Global 1940 2nd Edition*.
1–7 players (AI plays unclaimed powers), turn-based, shared-link, with a
TripleA-style sequence of play and an AI ported from TripleA's Pro AI
(GPL-3.0 — see LICENSE). See `README.md` for the full overview.

## Layout & where to work

| Task | File(s) |
|---|---|
| Unit stats / new unit types | `src/engine/data/units.ts` |
| Powers, alliances, turn order, starting IPC | `src/engine/data/powers.ts` |
| Map: territories, adjacency, IPC, board coords | `src/engine/data/territories.ts` |
| Starting unit placement | `src/engine/rules/setup.ts` |
| Movement / pathfinding rules | `src/engine/rules/movement.ts` |
| Naval transport & amphibious assault | `src/engine/rules/transport.ts` |
| Combat resolution (incl. bombardment, casualties) | `src/engine/rules/combat.ts` |
| Strategic bombing raids | `src/engine/rules/sbr.ts` |
| Research & technology | `src/engine/rules/research.ts` |
| Income / capital / National Objectives | `src/engine/rules/income.ts` |
| Phase sequence, mobilize, capacity, repair, victory | `src/engine/rules/phases.ts` |
| Politics: war matrix, declarations, US entry | `src/engine/rules/politics.ts` |
| Save-schema migrations | `src/engine/rules/migrate.ts` |
| The single action dispatcher (+ `expectedActor`) | `src/engine/rules/actions.ts` |
| AI driver (one action at a time) | `src/engine/ai/index.ts` |
| Pro AI (TripleA port, GPL) | `src/engine/ai/pro/` |
| Server (rooms, persistence, REST, AI stepper) | `src/server/` |
| Board UI (3D globe) | `src/client/components/GlobeBoard.tsx` |
| Phase control panels | `src/client/components/Sidebar.tsx`, `src/client/components/panels/` |
| Board↔satellite texture tooling | `tools/triplea/warp_earth.py` |

## Non-negotiables

- **All state changes go through `applyAction`** in `rules/actions.ts`. Never
  mutate `GameState` from the server or client directly.
- **The engine is deterministic and dependency-free.** No DOM, no Express, no
  React, no `Math.random` — dice come from `rules/rng.ts` (seed + counter on
  the state). This is what keeps the server authoritative and replayable.
- **The server is the source of truth.** The client may run the engine for
  optimistic preview, but the server's returned state always wins.
- Engine imports use `.js` specifiers (NodeNext-style) and resolve under both
  Vite (`@engine` alias) and tsx (relative paths in `src/server`).
- **The defender can act out of turn.** Battle prompts (casualties, scramble)
  are authorized via `expectedActor(state)` — never assume `activePower` is
  the only legal actor.
- **AI code under `src/engine/ai/pro/` is ported from TripleA** and carries
  GPL attribution headers — keep them when editing, and keep the project GPL.

## Verify before pushing

```bash
npm run typecheck && npm test && npm run build
```
