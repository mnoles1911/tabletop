import type { GameState, PowerId, Relation } from "../types.js";
import { POWERS, TURN_ORDER, sameAlliance } from "../data/powers.js";

// ============================================================================
// G40 politics: the pairwise war/neutral matrix and the declarations of war
// available to each power during its politics phase.
//
// Setup (2nd edition): Germany & Italy are at war with the United Kingdom,
// ANZAC and France; Japan is at war with China. Everyone else starts neutral
// towards the other side and must declare war before any combat move:
//   - Japan may declare on the UK bloc, the USA or the USSR at any time.
//   - Germany/Italy may declare on the USSR or the USA at any time.
//   - The USA may declare on the Axis from round 4 (it enters the war "at the
//     end of round 3"), or earlier the moment any Axis power declares on it.
//   - The USSR may declare on the European Axis from round 4; on Japan anytime.
//   - The UK bloc (UK / ANZAC / France) may declare on Japan at any time, and
//     declarations involving any bloc member pull in the whole bloc.
//   - China never declares war; it is only ever at war with Japan.
// Strict-neutral territories are not part of the matrix: invading one is its
// own declaration, handled by control.ts (the rest of the bloc swings).
// ============================================================================

/** UK, ANZAC and France declare war (and have it declared on them) as one bloc. */
export const WAR_BLOC: PowerId[] = ["UnitedKingdom", "Australia", "France"];

function rel(state: GameState, a: PowerId, b: PowerId): Relation {
  return state.relationships[a]?.[b] ?? "neutral";
}

export function setWar(state: GameState, a: PowerId, b: PowerId): void {
  (state.relationships[a] ??= {})[b] = "war";
  (state.relationships[b] ??= {})[a] = "war";
}

/**
 * True when the two powers may legally shoot at each other. Same-alliance
 * pairs are never at war; the synthetic Neutral power (garrisons of neutral
 * countries) resists everyone.
 */
export function atWar(state: GameState, a: PowerId, b: PowerId): boolean {
  if (a === b) return false;
  if (a === "Neutral" || b === "Neutral") return true;
  if (sameAlliance(a, b)) return false;
  return rel(state, a, b) === "war";
}

/** State-aware replacement for the old alliance-only enemy check. */
export const areEnemies = atWar;

/** Powers `power` may declare war on right now (its politics phase menu). */
export function availableDeclarations(state: GameState, power: PowerId): PowerId[] {
  const CANDIDATES: Partial<Record<PowerId, PowerId[]>> = {
    Germany: ["SovietUnion", "UnitedStates"],
    Italy: ["SovietUnion", "UnitedStates"],
    Japan: ["UnitedKingdom", "Australia", "France", "UnitedStates", "SovietUnion"],
    UnitedStates: ["Germany", "Italy", "Japan"],
    SovietUnion: ["Germany", "Italy", "Japan"],
    UnitedKingdom: ["Japan"],
    Australia: ["Japan"],
    France: ["Japan"],
  };
  const out: PowerId[] = [];
  for (const target of CANDIDATES[power] ?? []) {
    if (atWar(state, power, target)) continue;
    // US entry: only from round 4, unless the Axis brought it in earlier.
    if (power === "UnitedStates" && state.round < 4) continue;
    // USSR may not declare on the European Axis before round 4.
    if (power === "SovietUnion" && target !== "Japan" && state.round < 4) continue;
    out.push(target);
  }
  return out;
}

export interface DeclareResult {
  ok: boolean;
  reason?: string;
  /** Every power pulled into the war by this declaration (includes `target`). */
  nowAtWarWith: PowerId[];
}

/** Declare war during the politics phase. Bloc members join together. */
export function declareWar(state: GameState, actor: PowerId, target: PowerId): DeclareResult {
  if (!availableDeclarations(state, actor).includes(target)) {
    return { ok: false, reason: `${POWERS[actor].display} cannot declare war on ${POWERS[target].display} now.`, nowAtWarWith: [] };
  }
  const joined = new Set<PowerId>([target]);
  if (WAR_BLOC.includes(target)) for (const p of WAR_BLOC) joined.add(p);
  // A bloc member going to war brings the whole bloc with it.
  const actors = WAR_BLOC.includes(actor) ? WAR_BLOC : [actor];
  for (const a of actors) for (const t of joined) if (!sameAlliance(a, t)) setWar(state, a, t);
  return { ok: true, nowAtWarWith: [...joined] };
}

/** The Axis declaring on (or attacking) a power drags it into the war at once. */
export function forcedIntoWar(state: GameState, aggressor: PowerId, victim: PowerId): void {
  if (!sameAlliance(aggressor, victim)) setWar(state, aggressor, victim);
  if (WAR_BLOC.includes(victim)) {
    for (const p of WAR_BLOC) if (!sameAlliance(aggressor, p)) setWar(state, aggressor, p);
  }
}

/** The G40 opening relationships: Axis↔UK-bloc and Japan↔China at war. */
export function initialRelationships(): GameState["relationships"] {
  const m: GameState["relationships"] = {};
  const dummy = { relationships: m } as GameState;
  for (const axis of ["Germany", "Italy"] as PowerId[]) {
    for (const ally of WAR_BLOC) setWar(dummy, axis, ally);
  }
  setWar(dummy, "Japan", "China");
  return m;
}

/** Legacy (schema v1) behaviour: every Axis power at war with every Ally. */
export function totalWarRelationships(): GameState["relationships"] {
  const m: GameState["relationships"] = {};
  const dummy = { relationships: m } as GameState;
  for (const a of TURN_ORDER) {
    for (const b of TURN_ORDER) {
      if (POWERS[a].alliance === "Axis" && POWERS[b].alliance === "Allies") setWar(dummy, a, b);
    }
  }
  return m;
}
