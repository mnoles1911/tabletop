// Public engine surface — everything the client and server import from here.
export * from "./types.js";
export { UNITS, PURCHASABLE, unitDef, hasFlag } from "./data/units.js";
export { POWERS, TURN_ORDER, powerDef, areAllied, areEnemies } from "./data/powers.js";
export { TERRITORIES, TERRITORY_INDEX, isSea, isLand } from "./data/territories.js";
export { createInitialState, neighbours, unitsOf } from "./rules/setup.js";
export { applyAction } from "./rules/actions.js";
export type { Action, ActionResult } from "./rules/actions.js";
export { resolveBattle, stepBattle, retreatBattle, assignCasualties, autoCasualties } from "./rules/combat.js";
export type { CombatResult } from "./rules/combat.js";
export { checkMove } from "./rules/movement.js";
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
} from "./rules/phases.js";
export { hasTech, techName, RESEARCH_DIE_COST } from "./rules/research.js";
export { maxFactoryDamage } from "./rules/sbr.js";
