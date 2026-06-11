# Pro AI (Hard AI) — foundation layer

A faithful TypeScript port of the **foundation** of TripleA's Pro AI
(`games.strategy.triplea.ai.pro`), adapted to this engine's `GameState`. TripleA
is GPL-3.0; every file here carries a GPL header naming the exact Java class it
ports, and this project is itself `GPL-3.0-or-later` (see `package.json`).

These modules are pure functions over `GameState` — no classes holding a mutable
game reference; state is always passed explicitly. They never mutate the game
state (the odds calculator forks via `structuredClone`).

## Class → file mapping

| This file | Ported from (TripleA) |
|---|---|
| `ProMapGraph.ts` | Original, in the spirit of `engine.data.GameMap` / `Route` / `BreadthFirstSearch` and `ai.pro.util.ProUtils` route helpers — BFS distance maps over the adjacency graph. |
| `ProMatches.ts` | `ai.pro.util.ProMatches` (slimmed to the predicates with meaning here). |
| `ProBattleUtils.ts` | `ai.pro.util.ProBattleUtils` (`estimatePower` / `estimateStrength` / `estimateStrengthDifference` / `checkForOverwhelmingWin`). |
| `ProOddsCalculator.ts` | `ai.pro.util.ProOddsCalculator`, retargeted from `IBattleCalculator` to our `rules/combat.resolveBattle` simulator. |
| `ProTerritoryValueUtils.ts` | `ai.pro.util.ProTerritoryValueUtils` (`findTerritoryValues` and helpers, magic constants preserved). |
| `ProData.ts` | `ai.pro.ProData` (slim per-invocation snapshot built by `buildProData`). |
| `pro.test.ts` | New — `node:test` coverage of the above. |

## Faithfully ported

- **Strength math** — `estimateStrength = 2·hitPoints + power`, `power =
  pips·6/diceSides`, `estimateStrengthDifference = (atk−def)/def^0.85·50 + 50`
  with the all-infrastructure ⇒ 0 / 99999 short-circuits.
- **Odds sampling** — `runCount = max(16, 100 − minArmySize)`; win% / average
  survivors / TUV-swing aggregation; the `estimate*` fast paths (`<45` attacker
  hopeless, `>55` defender hopeless, only-air-vs-land exception).
- **Territory values** — `findLandValue` / `findWaterValue` /
  `findEnemyCapitalsAndFactoriesValue` / `findTerritoryAttackValue` structure and
  every constant (`3.0·production`, `·32`, `/(1+3·neutral)`, the `1/2^distance`
  decays, `·1.1` factory preference, `/100` and `/10` water mixing).
- **ProData** — win-percentage thresholds (95/75 low-luck, 90/65 dice),
  `minCostPerHitPoint`, live enemy capitals, my-unit territories.

## Documented degradations

- **No support attachments.** TripleA's `PowerStrengthAndRolls` /
  `supportAttachments` are replaced by this engine's `attackDice` / `defenseDice`,
  which already fold in **artillery pairing** and **tactical-bomber pairing**.
- **No territory effects.** `TerritoryEffectHelper` has no analogue here; all
  `territoryEffects(...)` inputs are dropped.
- **Movement legality delegated.** `ProMatches` does not re-implement canal
  validation / restriction matches; route legality is left to
  `rules/movement.checkMove`. `ProMapGraph` does a lightweight canal-gate check
  for sea reachability only.
- **Single UK economy.** Our engine models one United Kingdom (no UK-Europe /
  UK-Pacific split), so capital/production reasoning treats it as one power.
- **Planner-list parameters dropped.** `territoriesThatCantBeHeld` /
  `territoriesToAttack` (consumed by the not-yet-ported combat-move planner) are
  treated as empty in `findTerritoryValues`.
- **Odds simulator differences.** Instead of `AggregateResults`, the calculator
  forks a minimal `GameState` and runs the real `resolveBattle` per sample. Sub
  submerge-before-battle bookkeeping and bombardment-unit plumbing are handled
  inside `resolveBattle` rather than re-derived here. Determinism is preserved by
  reseeding each sample from `hash(seed, counter, i)`.
