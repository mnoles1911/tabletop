import type {
  GameOptions,
  GameState,
  PowerId,
  TerritoryState,
  UnitStack,
  UnitTypeId,
} from "../types.js";
import { DEFAULT_OPTIONS } from "../types.js";
import { TERRITORIES, TERRITORY_INDEX } from "../data/territories.js";
import { POWERS, TURN_ORDER } from "../data/powers.js";

// ============================================================================
// Initial game setup. Builds the opening GameState: controllers, treasuries,
// and a representative 1940 starting force on every front. The placement below
// gives each power a defensible capital, forward units on contested borders,
// and starting fleets, so the game is immediately playable end-to-end.
// ============================================================================

type Placement = [territory: string, units: Array<[UnitTypeId, number, PowerId?]>];

const STARTING_FORCES: Placement[] = [
  // Germany
  ["germany", [["infantry", 4], ["artillery", 2], ["tank", 3], ["fighter", 2], ["tactical_bomber", 1], ["major_ic", 1], ["aa_gun", 1]]],
  ["poland", [["infantry", 3], ["tank", 1], ["artillery", 1]]],
  ["norway", [["infantry", 1, "Germany"]]],
  ["balkans", [["infantry", 2]]],
  ["sz_baltic", [["submarine", 1, "Germany"], ["cruiser", 1, "Germany"], ["transport", 1, "Germany"]]],

  // Italy
  ["italy", [["infantry", 3], ["artillery", 1], ["fighter", 1], ["major_ic", 1]]],
  ["libya", [["infantry", 2], ["tank", 1]]],
  ["sz_med", [["cruiser", 1, "Italy"], ["destroyer", 1, "Italy"], ["transport", 1, "Italy"]]],

  // Soviet Union
  ["russia", [["infantry", 5], ["artillery", 2], ["tank", 2], ["fighter", 1], ["major_ic", 1], ["aa_gun", 1]]],
  ["ukraine", [["infantry", 3], ["artillery", 1]]],
  ["caucasus", [["infantry", 2], ["minor_ic", 1]]],
  ["novgorod", [["infantry", 2]]],

  // Japan
  ["japan", [["infantry", 3], ["artillery", 1], ["fighter", 2], ["tactical_bomber", 1], ["major_ic", 1], ["aa_gun", 1]]],
  ["manchuria", [["infantry", 3], ["artillery", 1], ["tank", 1]]],
  ["korea", [["infantry", 1]]],
  ["kwangtung", [["infantry", 2]]],
  ["sz_w_pacific", [["aircraft_carrier", 1, "Japan"], ["fighter", 1, "Japan"], ["battleship", 1, "Japan"], ["destroyer", 2, "Japan"], ["submarine", 1, "Japan"], ["transport", 2, "Japan"]]],

  // China
  ["szechwan", [["infantry", 4]]],
  ["yunnan", [["infantry", 2]]],
  ["kiangsu", [["infantry", 2, "China"]]],

  // United States
  ["eastern_usa", [["infantry", 2], ["artillery", 1], ["tank", 1], ["fighter", 1], ["strategic_bomber", 1], ["major_ic", 1], ["aa_gun", 1]]],
  ["western_usa", [["infantry", 2], ["fighter", 1], ["major_ic", 1]]],
  ["philippines", [["infantry", 1]]],
  ["sz_w_atlantic", [["battleship", 1, "UnitedStates"], ["destroyer", 1, "UnitedStates"], ["transport", 1, "UnitedStates"]]],
  ["sz_e_pacific", [["aircraft_carrier", 1, "UnitedStates"], ["fighter", 1, "UnitedStates"], ["cruiser", 1, "UnitedStates"], ["destroyer", 1, "UnitedStates"]]],

  // United Kingdom
  ["united_kingdom", [["infantry", 3], ["artillery", 1], ["fighter", 2], ["strategic_bomber", 1], ["major_ic", 1], ["aa_gun", 1]]],
  ["egypt", [["infantry", 2], ["artillery", 1], ["tank", 1]]],
  ["india", [["infantry", 3], ["artillery", 1], ["minor_ic", 1]]],
  ["eastern_canada", [["infantry", 1]]],
  ["sz_north", [["battleship", 1, "UnitedKingdom"], ["cruiser", 1, "UnitedKingdom"], ["destroyer", 1, "UnitedKingdom"], ["transport", 1, "UnitedKingdom"]]],

  // France
  ["france", [["infantry", 3], ["artillery", 1], ["fighter", 1]]],
  ["algeria", [["infantry", 1]]],

  // ANZAC (Australia)
  ["new_south_wales", [["infantry", 2], ["fighter", 1], ["minor_ic", 1]]],
  ["queensland", [["infantry", 1]]],
  ["new_zealand", [["infantry", 1]]],
  ["sz_coral", [["cruiser", 1, "Australia"], ["transport", 1, "Australia"]]],

  // Map-expansion garrisons
  ["gibraltar", [["infantry", 1]]],
  ["south_africa", [["infantry", 1]]],
  ["west_canada", [["infantry", 1]]],
  ["west_africa", [["infantry", 1]]],
  ["hawaii", [["infantry", 1], ["fighter", 1]]],
  ["siberia", [["infantry", 2]]],
  ["kazakhstan", [["infantry", 1]]],
];

/** Symmetrise the adjacency graph so every link is bidirectional. */
function buildAdjacency(): Record<string, Set<string>> {
  const adj: Record<string, Set<string>> = {};
  for (const t of TERRITORIES) adj[t.id] = new Set(t.adjacent);
  for (const t of TERRITORIES) {
    for (const n of t.adjacent) {
      if (adj[n]) adj[n].add(t.id);
    }
  }
  return adj;
}

const ADJ = buildAdjacency();

/** Public neighbour lookup used by the movement system. */
export const neighbours = (id: string): string[] => Array.from(ADJ[id] ?? []);

export function createInitialState(
  seed = Date.now() & 0xffffffff,
  options: GameOptions = DEFAULT_OPTIONS,
): GameState {
  const territories: Record<string, TerritoryState> = {};
  for (const t of TERRITORIES) {
    territories[t.id] = {
      id: t.id,
      controller: t.originalOwner,
      units: [],
    };
  }

  for (const [terr, units] of STARTING_FORCES) {
    const ts = territories[terr];
    if (!ts) throw new Error(`Setup references unknown territory: ${terr}`);
    const owner = TERRITORY_INDEX[terr].originalOwner;
    for (const [type, count, explicitOwner] of units) {
      const stackOwner = (explicitOwner ?? owner) as PowerId;
      if (!stackOwner) throw new Error(`No owner for units in ${terr}`);
      addUnits(ts, type, count, stackOwner);
    }
  }

  const treasury = Object.fromEntries(
    Object.values(POWERS).map((p) => [p.id, p.startingIPC]),
  ) as Record<PowerId, number>;

  return {
    schema: 1,
    version: 1,
    options,
    round: 1,
    activePower: TURN_ORDER[0],
    phase: "purchase",
    treasury,
    territories,
    purchases: [],
    combat: { battles: [] },
    transportUse: {},
    placement: {},
    tech: {},
    rng: { seed, counter: 0 },
    log: [
      { round: 1, power: TURN_ORDER[0], phase: "purchase", text: "Game begins — Germany's purchase phase." },
    ],
    eliminated: [],
  };
}

/** Add `count` units of `type` owned by `owner` to a territory, merging stacks. */
export function addUnits(
  ts: TerritoryState,
  type: UnitTypeId,
  count: number,
  owner: PowerId,
): void {
  const existing = ts.units.find((u) => u.type === type && u.owner === owner && !u.damage);
  if (existing) existing.count += count;
  else ts.units.push({ type, owner, count });
}

/** Remove `count` units of `type`/`owner`; returns how many were actually removed. */
export function removeUnits(
  ts: TerritoryState,
  type: UnitTypeId,
  count: number,
  owner: PowerId,
): number {
  let remaining = count;
  for (const stack of ts.units) {
    if (stack.type === type && stack.owner === owner && remaining > 0) {
      const take = Math.min(stack.count, remaining);
      stack.count -= take;
      remaining -= take;
    }
  }
  ts.units = ts.units.filter((u) => u.count > 0);
  return count - remaining;
}

/** Total units of a given owner sitting in a territory. */
export function unitsOf(ts: TerritoryState, owner: PowerId): UnitStack[] {
  return ts.units.filter((u) => u.owner === owner && u.count > 0);
}
