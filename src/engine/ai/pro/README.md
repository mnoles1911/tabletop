# Pro AI (Hard AI)

A faithful TypeScript port of TripleA's Pro AI
(`games.strategy.triplea.ai.pro`), adapted to this engine's `GameState`. TripleA
is GPL-3.0; every file here carries a GPL header naming the exact Java class it
ports, and this project is itself `GPL-3.0-or-later` (see `package.json`).

The **foundation layer** (map graph, matches, battle/odds utils, territory
values, territory manager, move/transport/purchase utils) is complete, and the
**planning layer** on top of it — the per-phase planners (`ProCombatMoveAi`,
`ProNonCombatMoveAi`, `ProPurchaseAi`, `ProRetreatAi`, `ProScrambleAi`,
`ProPoliticsAi`, `ProTechAi`, the casualty chooser) dispatched by `ProAi.ts` —
is now ported too.

These modules are pure functions over `GameState` — no classes holding a mutable
game reference; state is always passed explicitly. They never mutate the game
state (simulations fork via `structuredClone`) and never call `Math.random`:
any randomness flows through actions that roll on `state.rng`, or — for the
politics planner — a deterministic hash of `(seed, round, power, target)`.

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
| `ProAi.ts` | `ai.pro.AbstractProAi` — the driver: `planPhase` dispatches each phase to its planner; `answerBattlePrompt` answers scramble / casualty prompts; `nextCombatAction` drives the combat phase one round at a time. |
| `ProCombatMoveAi.ts` | `ai.pro.ProCombatMoveAi` — `populateAttackOptions` → `prioritizeAttackOptions` (attackValue formula) → `tryToAttackTerritories` (allocate minimal force per target) → `removeAttacksUntilCapitalCanBeHeld` (capital safety) → `calculateMoveActions`. |
| `ProNonCombatMoveAi.ts` | `ai.pro.ProNonCombatMoveAi` — defend threatened territories (capital → factories → front), land aircraft safely, advance idle land units toward the nearest enemy. |
| `ProPurchaseAi.ts` | `ai.pro.ProPurchaseAi` — `purchase()`: repair → defence (when capital threatened) → naval (when a fleet threatens) → air (when IPC-rich) → attack-efficiency land with artillery/infantry pairing, one consolidated buy. `place()`: defenders at threatened factories first, builders near the front, naval into the most useful adjacent sea zone. |
| `ProRetreatAi.ts` | `ai.pro.ProRetreatAi` — `shouldRetreat`: estimate odds on current forces; retreat when win% < `minWinPercentage` and the TUV swing is negative (or no land would remain). |
| `ProScrambleAi.ts` | `ai.pro.ProScrambleAi` — `shouldScramble`: scramble when the scrambled-air defence drops the attacker's win% meaningfully (≥10 pts, or flips a near-certain win). |
| `ProPoliticsAi.ts` | `ai.pro.ProPoliticsAi` — `warChance = roundFactor + attackPercentage·(1 + 10·roundFactor)`, `roundFactor = (round−1)·0.05`; true-neutral DoW ≈ 1%; compared against a deterministic hash (no `Math.random`, no `state.rng` consumption). |
| `ProTechAi.ts` | `ai.pro.ProTechAi` — buy spare-IPC research dice only when comfortably rich. |
| `ProCasualtyAi.ts` | `ai.pro.AbstractProAi.selectCasualties` — cheapest-first by `(cost, attack|defense)`, reserving a land unit for the attacker on land; falls back to `auto_casualties` when the choice is trivial/unsafe. |
| `pro.test.ts` | `node:test` coverage of the foundation and the planners. |

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

## Planner degradations (the per-phase port)

- **Unit allocation at stack granularity.** Java's `tryToAttackTerritories`
  adds individual `Unit`s; we add `{from,type,count}` stacks cheapest-strength-
  first until the win threshold is met (and a land unit would survive on land).
  Output is the same minimal-sufficient-force intent at coarser resolution.
- **Capital safety = single pass.** `removeAttacksUntilCapitalCanBeHeld` is
  reduced to: estimate the worst enemy counter-attack on the capital
  (`populateEnemyAttackOptions`), and if the committed attacks would strip the
  capital below a holding force, drop the lowest-`attackValue` attacks that draw
  from the capital until it is safe. The full recursive "can each territory be
  held" iteration is not reproduced.
- **`attackValue` formula.** `(tuvSwing + territoryValue) · winFactor`, with
  `territoryValue = findTerritoryAttackValue · (1+4·capital) · (1+2·factory) ·
  (1−0.9·neutral)`. The win percentage is folded in as a multiplier (Java keeps
  it as a separate accept/reject gate); the FFA and amphibious sub-terms are
  dropped.
- **Bounded simulation budget.** Each combat-move plan pays for at most
  `MAX_FULL_SIMS` (40) full odds simulations; beyond that it leans on the
  `estimateAttackOdds` fast path (strength-difference shortcut, `runCount 1`).
  This keeps the all-AI smoke test comfortably inside its action/time guard.
- **Non-combat is pragmatic.** No full value-iteration: defend the most valuable
  threatened territories until they out-defend the incoming enemy strength
  (1.2× margin), force aircraft home (the engine strands stranded air), and walk
  idle rear land one or two hops toward the nearest enemy. Air landing uses the
  graph range `+1`; `calculateMoveActions` re-validates the true air range.
- **Purchase "needs analysis" simplified.** Naval is bought only when an enemy
  warship sits in one of our coastal sea zones; defence land only when the
  capital faces ≥ 3 reachable enemy units; air only when treasury ≥ 30. Spend is
  capped per category (60% defence / 30% naval / 25% air) before the remaining
  treasury goes to attack-efficiency land with artillery↔infantry pairing.
- **Politics is deterministic.** Java draws a random `[0,1)`; we hash
  `(seed, round, power, target)` instead so planners never touch `Math.random`
  nor consume `state.rng`. At most one declaration per politics phase (the first
  whose `warChance` is met), keeping the war matrix evolution conservative.
- **Retreat / scramble / casualty thresholds** use `runCount 1` estimates (fast,
  deterministic) rather than full aggregate runs. The casualty chooser emits an
  explicit `assign_casualties` list only when non-trivial and safe, otherwise
  defers to the engine's `auto_casualties`.
