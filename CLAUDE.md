# CLAUDE.md — axis-allies-1940

Self-contained TypeScript project. **Unrelated to the Godot voxel game in the
parent repo** — it lives in this subfolder only because this session's GitHub
access is scoped to existing repos. It can be lifted into its own repo by
copying this directory.

## What it is

Online play-by-cloud implementation of *Axis & Allies Global 1940 2nd Edition*.
2–7 players, turn-based, shared-link. See `README.md` for the full overview.

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
| The single action dispatcher | `src/engine/rules/actions.ts` |
| Server (rooms, persistence, REST) | `src/server/` |
| Board UI | `src/client/components/Board.tsx` |
| Phase control panels | `src/client/components/Sidebar.tsx` |

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

## Verify before pushing

```bash
npm run typecheck && npm test && npm run build
```
