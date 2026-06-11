/*
 * Ported from TripleA (https://github.com/triplea-game/triplea)
 * games.strategy.triplea.ai.pro.data.ProTerritory — © TripleA contributors.
 * Licensed under the GNU General Public License v3.0 or later.
 *
 * Slim port. In Java ProTerritory is a mutable planning record holding live Unit
 * references (maxUnits, units, amphibAttackMap, transportTerritoryMap, value,
 * canHold, battleResult, …). Our engine has no per-unit identity — units live in
 * stacks — so a "unit that could attack here" is represented as a {from, type,
 * count} triple that RETAINS the source territory (which Java derives from the
 * Unit's location). We keep the fields the combat-move / defence / purchase
 * planners actually read and drop the rest (bombers, scramble, strafing,
 * temp maps, loadValue, …) as documented in README.md.
 */
import type { PowerId, UnitTypeId } from "../../types.js";
import type { ProBattleResult } from "./ProOddsCalculator.js";

// ============================================================================
// ProTerritory — a per-candidate-territory planning record. One is built for
// every territory the AI might attack, defend, or that an enemy might attack.
// ============================================================================

/**
 * A group of units that could (maxUnits) or will (units) move to the candidate
 * territory, tagged with the source territory they depart from. The {from}
 * stands in for the Java Unit's getLocation(), so move-utils can later emit a
 * legal {from→to} engine Action.
 */
export interface ProUnitOption {
  /** Source territory the units depart from. */
  from: string;
  type: UnitTypeId;
  count: number;
}

/**
 * An amphibious assault candidate: land units loaded at `from`, sailed across
 * the staging sea zone `via`, and landed at the ProTerritory's territoryId.
 * Mirrors Java's amphibAttackMap (transport→troops) + transportTerritoryMap,
 * collapsed to what checkTransport needs.
 */
export interface ProAmphibOption {
  /** Coastal land territory the troops load from. */
  from: string;
  /** Sea zone holding the transports (the staging / bombard zone). */
  via: string;
  units: { type: UnitTypeId; count: number }[];
}

export interface ProTerritory {
  /** The territory being analysed (Java: territory). */
  territoryId: string;
  /** Every stack that COULD attack/defend here, source territory retained. */
  maxUnits: ProUnitOption[];
  /** Committed units (a subset of maxUnits the planner has decided to send). */
  units: ProUnitOption[];
  /** Amphibious assault candidates against a coastal land target. */
  maxAmphibUnits: ProAmphibOption[];
  /** Committed amphibious assaults. */
  amphibUnits: ProAmphibOption[];
  /** Cached odds-calculator result, lazily filled by the planner. */
  battleResult?: ProBattleResult;
  /** Strategic value (ProTerritoryValueUtils). */
  value: number;
  /** Whether we can hold it after taking it (Java: canHold). */
  canHold: boolean;
  /** Whether an attack here is even possible (Java: canAttack). */
  canAttack: boolean;
}

/** Construct an empty ProTerritory for `territoryId` (Java: new ProTerritory). */
export function createProTerritory(territoryId: string): ProTerritory {
  return {
    territoryId,
    maxUnits: [],
    units: [],
    maxAmphibUnits: [],
    amphibUnits: [],
    value: 0,
    canHold: false,
    canAttack: false,
  };
}

/** ProTerritory.addMaxUnit — record a stack that could reach here, merging like sources. */
export function addMaxUnit(pt: ProTerritory, opt: ProUnitOption): void {
  mergeInto(pt.maxUnits, opt);
  pt.canAttack = true;
}

/** ProTerritory.addUnit — commit a stack to actually move here. */
export function addUnit(pt: ProTerritory, opt: ProUnitOption): void {
  mergeInto(pt.units, opt);
}

/** ProTerritory.addMaxAmphibUnits / putAmphibAttackMap (max side). */
export function addMaxAmphibOption(pt: ProTerritory, opt: ProAmphibOption): void {
  pt.maxAmphibUnits.push(opt);
  pt.canAttack = true;
}

/** Total physical units across a ProUnitOption list. */
export function totalUnits(opts: ProUnitOption[]): number {
  return opts.reduce((n, o) => n + o.count, 0);
}

/** Flatten committed (and optionally amphibious) units into plain {type,owner} stacks. */
export function committedStacks(
  pt: ProTerritory,
  owner: PowerId,
): { type: UnitTypeId; owner: PowerId; count: number }[] {
  const out: { type: UnitTypeId; owner: PowerId; count: number }[] = [];
  for (const u of pt.units) out.push({ type: u.type, owner, count: u.count });
  for (const a of pt.amphibUnits) {
    for (const u of a.units) out.push({ type: u.type, owner, count: u.count });
  }
  return out;
}

function mergeInto(list: ProUnitOption[], opt: ProUnitOption): void {
  if (opt.count <= 0) return;
  const existing = list.find((o) => o.from === opt.from && o.type === opt.type);
  if (existing) existing.count += opt.count;
  else list.push({ ...opt });
}
