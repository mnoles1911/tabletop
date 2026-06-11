/*
 * Ported from TripleA (https://github.com/triplea-game/triplea)
 * games.strategy.triplea.ai.pro.util.ProBattleUtils — © TripleA contributors.
 * Licensed under the GNU General Public License v3.0 or later.
 *
 * Ported faithfully: estimatePower / estimateStrength / estimateStrengthDifference
 * and the SHORT_RANGE / MEDIUM_RANGE constants. Power comes from our combat
 * dice helpers (attackDice / defenseDice), which already fold in artillery
 * support and tactical-bomber pairing — so we do not separately model TripleA's
 * support attachments. Degraded: territoryEffects (none in our model) and the
 * PowerStrengthAndRolls multi-roll machinery (bombers rolling extra dice) are
 * absorbed into our pip helpers where applicable.
 */
import type { GameState, PowerId, UnitStack, UnitTypeId } from "../../types.js";
import { UNITS } from "../../data/units.js";
import { isSea } from "../../data/territories.js";
import { attackDice, defenseDice } from "../../rules/combat.js";

// ============================================================================
// ProBattleUtils — fast, dice-free strength estimates the Pro AI uses to triage
// battles before paying for a full Monte-Carlo simulation.
//
// estimateStrength(t, mine, enemy, attacking) = 2 * hitPoints(mine) + power(mine)
//   power(mine) = sum-of-pips * 6 / diceSides   (diceSides = 6, so power = pips)
// estimateStrengthDifference(t, atk, def):
//   0   => defender overwhelmingly stronger
//   50  => even
//   100+=> attacker overwhelmingly stronger
// ============================================================================

export const SHORT_RANGE = 2;
export const MEDIUM_RANGE = 3;

const DICE_SIDES = 6;

/** A unit either as a stack (type/owner/count) or a single {type,owner}. */
export type StrengthUnit = UnitStack | { type: UnitTypeId; owner: PowerId; count?: number };

/** Expand stacks into one {type,owner} entry per physical unit. */
function expand(units: StrengthUnit[]): { type: UnitTypeId; owner: PowerId }[] {
  const out: { type: UnitTypeId; owner: PowerId }[] = [];
  for (const u of units) {
    const n = "count" in u && typeof u.count === "number" ? u.count : 1;
    for (let i = 0; i < n; i++) out.push({ type: u.type, owner: u.owner });
  }
  return out;
}

const isInfra = (type: UnitTypeId): boolean =>
  UNITS[type].domain === "structure" || type === "aa_gun";

/** Total hit points of units that can fight (infrastructure has none). */
function hitPoints(units: { type: UnitTypeId; owner: PowerId }[]): number {
  let hp = 0;
  for (const u of units) if (!isInfra(u.type)) hp += UNITS[u.type].hits;
  return hp;
}

/**
 * estimatePower — sum of combat pips of `units` (attacking or defending),
 * scaled by 6/diceSides as in the Java. Uses our attackDice/defenseDice so
 * artillery support and tac-bomber pairing are already reflected.
 */
export function estimatePower(
  state: GameState,
  units: { type: UnitTypeId; owner: PowerId }[],
  attacking: boolean,
  attacker: PowerId,
): number {
  const fighters = units.filter((u) => !isInfra(u.type));
  const pips = attacking
    ? attackDice(state, fighters, attacker).reduce((s, p) => s + p, 0)
    : defenseDice(state, fighters).reduce((s, p) => s + p, 0);
  return (pips * 6.0) / DICE_SIDES;
}

/**
 * estimateStrength — the larger the result, the stronger `myUnits` are versus
 * `enemyUnits`. = 2 * hitPoints + power. (`enemyUnits` is accepted to match the
 * Java signature; our power helpers don't need it since support is baked in.)
 */
export function estimateStrength(
  state: GameState,
  myUnits: StrengthUnit[],
  attacking: boolean,
  owner: PowerId,
): number {
  const expanded = expand(myUnits);
  const fightable = expanded.filter((u) => !isInfra(u.type));
  const myHitPoints = hitPoints(fightable);
  const myPower = estimatePower(state, fightable, attacking, owner);
  return 2.0 * myHitPoints + myPower;
}

/**
 * estimateStrengthDifference — 0..100+ where 50 is even. Faithful to the Java:
 * all-infrastructure or zero-power attacker => 0; same for defender => 99999.
 */
export function estimateStrengthDifference(
  state: GameState,
  territory: string,
  attackingUnits: StrengthUnit[],
  defendingUnits: StrengthUnit[],
): number {
  const atk = expand(attackingUnits);
  const def = expand(defendingUnits);
  const attacker = atk[0]?.owner ?? "Neutral";
  const defender = def[0]?.owner ?? "Neutral";

  if (atk.every((u) => isInfra(u.type)) || estimatePower(state, atk.filter((u) => !isInfra(u.type)), true, attacker) <= 0) {
    return 0;
  }
  if (def.every((u) => isInfra(u.type)) || estimatePower(state, def.filter((u) => !isInfra(u.type)), false, defender) <= 0) {
    return 99_999;
  }
  const attackerStrength = estimateStrength(state, attackingUnits, true, attacker);
  const defenderStrength = estimateStrength(state, defendingUnits, false, defender);
  return ((attackerStrength - defenderStrength) / Math.pow(defenderStrength, 0.85)) * 50 + 50;
}

/**
 * checkForOverwhelmingWin — true when the attacker wins without loss or within
 * one round: no defenders, defenders have zero power, or attack power / dice >=
 * total defender hit points. Faithful to the Java.
 */
export function checkForOverwhelmingWin(
  state: GameState,
  territory: string,
  attackingUnits: StrengthUnit[],
  defendingUnits: StrengthUnit[],
): boolean {
  const atk = expand(attackingUnits);
  const def = expand(defendingUnits);
  const defendersWithHp = def.filter((u) => !isInfra(u.type));

  if (defendersWithHp.length === 0 && atk.length > 0) return true;

  const power = estimatePower(state, def.filter((u) => !isInfra(u.type)), false, def[0]?.owner ?? "Neutral");
  if (power === 0 && atk.length > 0) return true;

  const attacker = atk[0]?.owner ?? "Neutral";
  const attackPower = estimatePower(state, atk.filter((u) => !isInfra(u.type)), true, attacker);
  const totalDefenderHitPoints = hitPoints(defendersWithHp);
  return attackPower / DICE_SIDES >= totalDefenderHitPoints;
}

/** Average power per fighting unit — handy for tie-breaks (ProBattleUtils helper). */
export function averagePower(
  state: GameState,
  units: StrengthUnit[],
  attacking: boolean,
): number {
  const expanded = expand(units).filter((u) => !isInfra(u.type));
  if (expanded.length === 0) return 0;
  const owner = expanded[0].owner;
  return estimatePower(state, expanded, attacking, owner) / expanded.length;
}

/** Helper kept for symmetry with callers that pass a territory and need water-ness. */
export const territoryIsWater = (id: string): boolean => isSea(id);
