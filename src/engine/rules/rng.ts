// ============================================================================
// Deterministic RNG. Dice must be reproducible and auditable: the game state
// carries a seed + counter, and every die roll advances the counter. Replaying
// the same actions against the same seed yields identical battles, which keeps
// the server authoritative and lets clients verify results.
//
// Uses mulberry32 — a small, fast, well-distributed 32-bit PRNG.
// ============================================================================

import type { GameState } from "../types.js";

function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Roll a single six-sided die, mutating the state's RNG counter. */
export function rollDie(state: GameState): number {
  const rand = mulberry32(state.rng.seed + state.rng.counter * 2654435761);
  state.rng.counter += 1;
  return Math.floor(rand() * 6) + 1;
}

/** Roll `n` dice, returning each result. */
export function rollDice(state: GameState, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(rollDie(state));
  return out;
}

/** Count how many of `rolls` are <= `target` (i.e. hits). */
export const countHits = (rolls: number[], target: number): number =>
  rolls.filter((r) => r <= target).length;
