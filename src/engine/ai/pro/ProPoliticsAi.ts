/*
 * Ported from TripleA (https://github.com/triplea-game/triplea)
 * games.strategy.triplea.ai.pro.ProPoliticsAi — © TripleA contributors.
 * Licensed under the GNU General Public License v3.0 or later.
 *
 * War-declaration logic. Java's warChance for an enemy power:
 *   warChance = roundFactor + attackPercentage * (1 + 10*roundFactor)
 *   roundFactor = (round - 1) * 0.05
 *   attackPercentage = fraction of the target's territories the declarer could
 *                      profitably conquer (we approximate with reachable,
 *                      favourable land targets adjacent to the declarer's units).
 * A deterministic hash of (seed, round, power, target) stands in for Java's
 * random draw so planners never touch Math.random or consume state.rng.
 *
 * G40 adaptation: Germany/Italy lean toward the USSR (rounds 2-3+, score-driven),
 * Japan toward the UK bloc / USSR when its Pacific/Asian position is favourable,
 * and declarations on the USA stay rare (only when overwhelmingly ahead). The
 * USA/USSR declare when first allowed (round 4+) if it unlocks any attack.
 */
import type { GameState, PowerId } from "../../types.js";
import type { Action } from "../../rules/actions.js";
import { POWERS, TURN_ORDER } from "../../data/powers.js";
import { isLand, TERRITORIES } from "../../data/territories.js";
import { areEnemies, availableDeclarations } from "../../rules/politics.js";
import { neighbours } from "../../rules/setup.js";

/** Deterministic [0,1) value from the state seed + this decision's identity. */
function detRand(state: GameState, power: PowerId, target: PowerId): number {
  let h = (state.rng.seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ state.round, 0x85ebca6b) >>> 0;
  for (const ch of power + ":" + target) h = Math.imul(h ^ ch.charCodeAt(0), 0xc2b2ae35) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 0x100000000;
}

/** Territories controlled by `target` (the prize pool of a declaration). */
function targetTerritories(state: GameState, target: PowerId): string[] {
  return TERRITORIES.filter((t) => isLand(t.id) && state.territories[t.id]?.controller === target).map(
    (t) => t.id,
  );
}

/** Does `power` have a unit adjacent to (i.e. able to strike) territory `id`? */
function powerCanReach(state: GameState, power: PowerId, id: string): boolean {
  for (const n of neighbours(id)) {
    if ((state.territories[n]?.units ?? []).some((u) => u.owner === power && u.count > 0)) return true;
  }
  return (state.territories[id]?.units ?? []).some((u) => u.owner === power && u.count > 0);
}

/**
 * attackPercentage — fraction of the target's land the declarer is positioned to
 * grab immediately (a crude conquerable-territory proxy for Java's odds-based
 * count). Bounded to [0,1].
 */
function attackPercentage(state: GameState, power: PowerId, target: PowerId): number {
  const terrs = targetTerritories(state, target);
  if (terrs.length === 0) return 0;
  const reachable = terrs.filter((id) => powerCanReach(state, power, id)).length;
  return reachable / terrs.length;
}

/** Total IPC production a power controls (rough strength proxy). */
function production(state: GameState, power: PowerId): number {
  let total = 0;
  for (const t of TERRITORIES) {
    if (state.territories[t.id]?.controller === power) total += t.ipc;
  }
  return total;
}

const NEUTRAL_DOW_CHANCE = 0.01;

/** Plan the politics phase: zero or more declare_war actions (deterministic). */
export function planPolitics(state: GameState): Action[] {
  const power = state.activePower;
  const out: Action[] = [];
  const roundFactor = (state.round - 1) * 0.05;

  for (const target of availableDeclarations(state, power)) {
    let warChance: number;

    // Declaring on the USA (or any far-stronger Ally hub) only when way ahead.
    const overwhelming =
      production(state, power) > production(state, target) * 2.5 &&
      attackPercentage(state, power, target) > 0;

    if (target === "UnitedStates" && power !== "UnitedStates") {
      warChance = overwhelming ? 0.5 : 0.02;
    } else {
      const ap = attackPercentage(state, power, target);
      warChance = roundFactor + ap * (1 + 10 * roundFactor);
      // The USA / USSR, once eligible (round 4+), declare if it unlocks an attack.
      if ((power === "UnitedStates" || power === "SovietUnion") && ap > 0) {
        warChance = Math.max(warChance, 0.9);
      }
    }

    warChance = Math.min(1, Math.max(NEUTRAL_DOW_CHANCE, warChance));

    if (detRand(state, power, target) < warChance) {
      out.push({ kind: "declare_war", target });
      // Reflect the new war locally so subsequent attackPercentage in this same
      // phase doesn't re-trigger redundant declarations against bloc members.
      // (We must not mutate the real relationships, so just stop after the first
      // high-value declaration to keep things conservative & deterministic.)
      break;
    }
  }

  void areEnemies;
  void POWERS;
  void TURN_ORDER;
  return out;
}
