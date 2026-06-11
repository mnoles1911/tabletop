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
import { STARTING_FORCES } from "../data/setup.generated.js";
import { POWERS, TURN_ORDER } from "../data/powers.js";

// ============================================================================
// Initial game setup. Builds the opening GameState: controllers, treasuries,
// and the official 1940 2nd-edition starting forces on every front. The
// placement table itself is generated from the TripleA board data — see
// `data/setup.generated.ts` — so it always matches the map.
// ============================================================================

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
