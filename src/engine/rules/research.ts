import type { GameState, PowerId, TechId } from "../types.js";
import { ALL_TECHS, TECH_NAMES } from "../types.js";
import { rollDie } from "./rng.js";

// ============================================================================
// Research & Development (optional). In the purchase phase a power may spend
// IPC to buy research dice (5 IPC each). Each die that comes up 6 is a
// breakthrough, granting a new technology the power doesn't already have.
// A handful of techs have concrete effects wired into combat, income, and
// production; the rest are tracked for flavour and easy extension.
// ============================================================================

export const RESEARCH_DIE_COST = 5;

export function hasTech(state: GameState, power: PowerId, tech: TechId): boolean {
  return (state.tech[power] ?? []).includes(tech);
}

export interface ResearchResult {
  rolls: number[];
  breakthroughs: TechId[];
}

/** Spend `dice * 5` IPC and roll for breakthroughs. */
export function buyResearch(state: GameState, power: PowerId, dice: number): ResearchResult | { error: string } {
  if (!state.options.research) return { error: "Research is disabled for this game." };
  if (dice <= 0) return { error: "Buy at least one research die." };
  const cost = dice * RESEARCH_DIE_COST;
  if (state.treasury[power] < cost) return { error: `Need ${cost} IPC for ${dice} research dice.` };
  state.treasury[power] -= cost;

  const owned = new Set(state.tech[power] ?? []);
  const available = ALL_TECHS.filter((t) => !owned.has(t));
  const rolls: number[] = [];
  const breakthroughs: TechId[] = [];
  for (let i = 0; i < dice; i++) {
    const r = rollDie(state);
    rolls.push(r);
    if (r === 6 && available.length > 0) {
      // Pick the next unowned tech deterministically by the RNG.
      const idx = rollDie(state) % available.length;
      const tech = available.splice(idx, 1)[0];
      breakthroughs.push(tech);
    }
  }
  if (breakthroughs.length) {
    state.tech[power] = [...(state.tech[power] ?? []), ...breakthroughs];
  }
  return { rolls, breakthroughs };
}

export const techName = (t: TechId): string => TECH_NAMES[t];
