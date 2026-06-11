import type { GameState, PowerId } from "../types.js";
import { hasFlag } from "../data/units.js";
import { POWERS } from "../data/powers.js";
import { TERRITORY_INDEX } from "../data/territories.js";
import { rollDie } from "./rng.js";
import { hasTech } from "./research.js";
import { addUnits, removeUnits } from "./setup.js";

// ============================================================================
// Strategic bombing raids. Strategic bombers fly to an enemy territory with an
// industrial complex. Defending anti-air fires first (one die per bomber, a 1
// destroys a bomber); each surviving bomber then rolls for production damage
// (Heavy Bombers tech rolls two dice). Damage accumulates on the factory and
// throttles production until repaired in the purchase phase. The bombers fly
// home to their staging territory afterwards.
// ============================================================================

/** Maximum strategic damage a factory can carry (twice its output value). */
export function maxFactoryDamage(territoryId: string): number {
  return Math.max(6, (TERRITORY_INDEX[territoryId]?.ipc ?? 0) * 2);
}

export interface SbrResult {
  territory: string;
  attacker: PowerId;
  bombersLost: number;
  damageDealt: number;
  text: string[];
}

export function resolveSBR(state: GameState, territory: string, stagingFrom: string): SbrResult {
  const ts = state.territories[territory];
  const attacker = state.combat.battles.find((b) => b.territory === territory)?.attacker ?? state.activePower;
  const text: string[] = [];

  let bombers = ts.units
    .filter((u) => u.owner === attacker && u.type === "strategic_bomber")
    .reduce((n, u) => n + u.count, 0);
  if (bombers === 0) {
    text.push("No bombers present for the raid.");
    return { territory, attacker, bombersLost: 0, damageDealt: 0, text };
  }

  // Defending anti-air: one shot per bomber, a 1 is a hit.
  const aaGuns = ts.units
    .filter((u) => hasFlag(u.type, "aa_fire") && u.owner !== attacker)
    .reduce((n, u) => n + u.count, 0);
  let bombersLost = 0;
  if (aaGuns > 0) {
    for (let i = 0; i < bombers; i++) if (rollDie(state) === 1) bombersLost++;
    if (bombersLost > 0) {
      removeUnits(ts, "strategic_bomber", bombersLost, attacker);
      bombers -= bombersLost;
      text.push(`AAA over ${TERRITORY_INDEX[territory].display} downs ${bombersLost} bomber(s).`);
    }
  }

  // Surviving bombers roll for damage.
  const heavy = hasTech(state, attacker, "heavy_bombers");
  let damage = 0;
  for (let i = 0; i < bombers; i++) {
    damage += rollDie(state);
    if (heavy) damage += rollDie(state); // Heavy Bombers: two dice.
  }
  const cap = maxFactoryDamage(territory);
  const current = ts.factoryDamage ?? 0;
  const applied = Math.min(damage, cap - current);
  ts.factoryDamage = current + applied;
  text.push(`${POWERS[attacker].display} bombs ${TERRITORY_INDEX[territory].display}'s factory for ${applied} damage (${ts.factoryDamage}/${cap}).`);

  // Bombers fly home.
  if (bombers > 0 && stagingFrom && state.territories[stagingFrom]) {
    removeUnits(ts, "strategic_bomber", bombers, attacker);
    addUnits(state.territories[stagingFrom], "strategic_bomber", bombers, attacker);
  }

  return { territory, attacker, bombersLost, damageDealt: applied, text };
}
