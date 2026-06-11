// Public engine surface — everything the client and server import from here.
export * from "./types.js";
export { UNITS, PURCHASABLE, unitDef, hasFlag } from "./data/units.js";
export { POWERS, TURN_ORDER, powerDef, areAllied, sameAlliance } from "./data/powers.js";
export { areEnemies, atWar, availableDeclarations, declareWar, WAR_BLOC } from "./rules/politics.js";
export { migrateState } from "./rules/migrate.js";
export { TERRITORIES, TERRITORY_INDEX, isSea, isLand, CANALS, canalGate, canalGates } from "./data/territories.js";
export type { Canal } from "./data/territories.js";
export { BORDERS } from "./data/borders.js";
export { createInitialState, neighbours, unitsOf } from "./rules/setup.js";
export { applyAction, expectedActor } from "./rules/actions.js";
export type { Action, ActionResult } from "./rules/actions.js";
export {
  resolveBattle,
  stepBattle,
  retreatBattle,
  assignCasualties,
  autoCasualties,
  acceptScramble,
  declineScramble,
  submergeSubs,
  battleDefender,
  scrambleSources,
  attackDice,
  defenseDice,
  KAMIKAZE_ISLANDS,
} from "./rules/combat.js";
export type { BattleSide, StepResult } from "./rules/combat.js";
export type { CombatResult } from "./rules/combat.js";
export { checkMove, movementAllowance } from "./rules/movement.js";
export type { MoveRequest, MoveCheck } from "./rules/movement.js";
export { checkTransport } from "./rules/transport.js";
export type { TransportRequest, TransportCheck } from "./rules/transport.js";
export {
  territoryIncome,
  collectibleIncome,
  controlsOwnCapital,
  nationalObjectiveBonus,
  convoyLoss,
} from "./rules/income.js";
export {
  advancePhase,
  placementOptions,
  checkVictory,
  factoryCapacity,
  remainingCapacity,
  repairFactory,
  labelFor,
  PHASE_ORDER,
} from "./rules/phases.js";
export { hasTech, techName, RESEARCH_DIE_COST } from "./rules/research.js";
export { maxFactoryDamage } from "./rules/sbr.js";
