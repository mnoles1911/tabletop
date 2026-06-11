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
| `ProTerritory.ts` | `ai.pro.data.ProTerritory` (slim planning record: `maxUnits`/`units` as `{from,type,count}`, amphib candidates, `value`, `canHold`, cached `battleResult`). |
| `ProTerritoryManager.ts` | `ai.pro.data.ProTerritoryManager` (`populateAttackOptions` / `populateDefenseOptions` / `populateEnemyAttackOptions` — the max-reachable-unit targeting workhorse). |
| `ProMoveUtils.ts` | `ai.pro.util.ProMoveUtils` (`calculateMoveActions` — committed plans → ordered, validated engine `Action[]`). |
| `ProTransportUtils.ts` | `ai.pro.util.ProTransportUtils` (slim: transport free-capacity math + value-dense `findBestUnitsToLoad`). |
| `ProPurchaseUtils.ts` | `ai.pro.util.ProPurchaseUtils` + `ai.pro.data.ProPurchaseOption` (efficiency records, `findPurchaseOptions`, `findPlaceTerritories`). |
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
- **No per-unit identity (targeting layer).** TripleA's `ProTerritory` holds live
  `Unit` references and maps (`amphibAttackMap`, `transportTerritoryMap`,
  `isTransportingMap`); our engine stores units as stacks, so a reachable unit is a
  `{from, type, count}` triple that retains the source territory. Dropped
  `ProTerritory` fields with no analogue: `bombers`/`maxBombardUnits`, `strafing`,
  `maxScrambleUnits`, the `temp*` maps, `loadValue`, and the min/max `BattleResult`
  caches (one cached `battleResult` is kept).
- **Route legality delegated (manager / move-utils).** `ProTerritoryManager` and
  `ProMoveUtils` do not re-implement `GameMap.getRouteForUnit` / per-step territory
  predicates. They prune the source×target cross-product with `ProMapGraph` hop
  distances (`≤ allowance + 1`) and then confirm each candidate with the engine's
  authoritative `movement.checkMove` / `transport.checkTransport`. Output fidelity
  (correct max-unit sets) is favoured over line-by-line route fidelity, per spec.
- **Phase-flip via clone.** `checkMove`/`checkTransport` require the right phase and
  `activePower`; `populateDefenseOptions` (noncombat) and `populateEnemyAttackOptions`
  (each enemy's combat move) validate against a `structuredClone` with `phase` and
  `activePower` set, since the engine has no "hypothetical actor" parameter. Enemy
  options use only the current war matrix (no speculative declarations).
- **Move batching order.** `ProMoveUtils.calculateMoveActions` emits naval → amphibious
  (transport) → land → air and validates each against a progressively-updated clone
  (applying accepted actions so later checks see earlier moves), dropping any that
  fail — the practical equivalent of Java's `doMove` route ordering.
- **Purchase efficiencies (uniform quantity / dice).** `ProPurchaseOption` keeps the
  exact Java formulas (`costPerHitPoint`, `hitPointEfficiency`,
  `attackEfficiency`, `defenseEfficiency`, `transportEfficiency`) but with
  `quantity = 1` (one unit per production rule here) and `diceSides = 6` (the
  `× 6 / diceSides` factor is identity). No `carrierEfficiency` (absent in Java).
  Transport cost is a uniform 1 slot/unit, matching `transport.ts`. China's
  infantry-only rule is honoured.
- **Odds simulator differences.** Instead of `AggregateResults`, the calculator
  forks a minimal `GameState` and runs the real `resolveBattle` per sample. Sub
  submerge-before-battle bookkeeping and bombardment-unit plumbing are handled
  inside `resolveBattle` rather than re-derived here. Determinism is preserved by
  reseeding each sample from `hash(seed, counter, i)`.
