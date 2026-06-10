// ============================================================================
// Core type definitions for the Axis & Allies Global 1940 rules engine.
//
// Everything in the engine is data-driven and deterministic: given a GameState
// and an Action, the reducer (rules/reducer.ts) produces a new GameState plus a
// log of what happened. The same engine code runs on the server (authoritative)
// and the client (optimistic preview), which is why it has zero dependencies on
// React, Express, or the DOM.
// ============================================================================

// --- Powers --------------------------------------------------------------

/** The nine playing powers of Global 1940 2nd Edition. */
export type PowerId =
  | "Germany"
  | "SovietUnion"
  | "Japan"
  | "UnitedStates"
  | "China"
  | "UnitedKingdom"
  | "Italy"
  | "Australia" // ANZAC
  | "France";

export type Alliance = "Axis" | "Allies";

export interface PowerDef {
  id: PowerId;
  display: string;
  alliance: Alliance;
  color: string;
  /** Territory id of this power's capital. Losing it surrenders its treasury. */
  capital: string;
  startingIPC: number;
  /** Turn order index within a full round (lower goes first). */
  turnOrder: number;
}

// --- Units ---------------------------------------------------------------

export type UnitTypeId =
  | "infantry"
  | "mech_infantry"
  | "artillery"
  | "tank"
  | "aa_gun"
  | "fighter"
  | "tactical_bomber"
  | "strategic_bomber"
  | "submarine"
  | "destroyer"
  | "cruiser"
  | "aircraft_carrier"
  | "battleship"
  | "transport"
  | "major_ic" // major industrial complex
  | "minor_ic"; // minor industrial complex

export type Domain = "land" | "air" | "sea" | "structure";

export interface UnitDef {
  id: UnitTypeId;
  display: string;
  domain: Domain;
  cost: number;
  attack: number;
  defense: number;
  movement: number;
  /** Hit points absorbed before the unit is removed (battleships = 2). */
  hits: number;
  /** Sea transport / carrier capacity in "slots". */
  capacity?: number;
  /** True for units that can never move on their own (factories, AA). */
  immobileInCombatMove?: boolean;
  /** Combat keywords resolved specially by the combat engine. */
  flags?: UnitFlag[];
}

export type UnitFlag =
  | "surprise_strike" // submarine first-strike when no enemy destroyer present
  | "submersible" // submarine may submerge instead of taking casualties
  | "cant_hit_air" // submarines cannot fire at air unless a destroyer is present
  | "negates_sub_special" // destroyer cancels submarine surprise/submerge/sneak
  | "two_hit" // battleship
  | "carries_air" // aircraft carrier
  | "transports_land" // transport
  | "artillery_support" // boosts a paired infantry's attack to 2
  | "tactical_pair" // tac bomber attacks at 4 when paired with fighter/tank
  | "aa_fire" // anti-air opening fire vs air units
  | "bombard" // battleship/cruiser shore bombardment during amphibious assault
  | "factory"; // industrial complex (produces units, can be strat-bombed)

/** A stack of identical units sitting in one territory, owned by one power. */
export interface UnitStack {
  type: UnitTypeId;
  owner: PowerId;
  count: number;
  /** Hits already absorbed this combat (cleared between battles). */
  damage?: number;
}

// --- Territories & map ---------------------------------------------------

export type TerrainType = "land" | "sea" | "capital" | "island";

export interface TerritoryDef {
  id: string;
  display: string;
  terrain: TerrainType;
  /** IPC income produced when controlled (0 for sea zones & empty land). */
  ipc: number;
  /** PowerId that originally owns this territory at game start. */
  originalOwner?: PowerId;
  /** Adjacent territory ids (movement graph; symmetric). */
  adjacent: string[];
  /** Layout position for the SVG board (abstract grid coords, 0..100). */
  x: number;
  y: number;
  /** Victory city — relevant to the global victory conditions. */
  victoryCity?: boolean;
}

/** Mutable per-territory runtime state. */
export interface TerritoryState {
  id: string;
  /** Current controller (may differ from original owner after conquest). */
  controller?: PowerId;
  units: UnitStack[];
  /** Strategic-bombing damage on this territory's factory. */
  factoryDamage?: number;
}

// --- Game state ----------------------------------------------------------

export type Phase =
  | "purchase" // buy units & repair
  | "combat_move" // move units into hostile territory
  | "combat" // resolve battles
  | "noncombat_move" // reposition, land aircraft
  | "mobilize" // place purchased units at factories
  | "collect_income"; // bank IPCs, then pass to next power

export interface PendingPurchase {
  type: UnitTypeId;
  count: number;
}

/** A battle queued during combat-move, resolved during the combat phase. */
export interface PendingBattle {
  territory: string;
  attacker: PowerId;
  /** True once the battle has been fully resolved. */
  resolved: boolean;
  /** Set when this battle is an amphibious assault (carries shore bombard). */
  amphibious?: boolean;
}

export interface CombatState {
  battles: PendingBattle[];
  /** Territory whose battle dialog is currently open on the active client. */
  active?: string;
}

export interface GameState {
  schema: 1;
  /** Monotonic version; the server rejects stale-version actions. */
  version: number;
  round: number;
  activePower: PowerId;
  phase: Phase;
  /** Treasury per power. */
  treasury: Record<PowerId, number>;
  territories: Record<string, TerritoryState>;
  /** Units purchased this turn, awaiting placement in mobilize. */
  purchases: PendingPurchase[];
  combat: CombatState;
  /** Deterministic RNG seed + counter so dice are reproducible & auditable. */
  rng: { seed: number; counter: number };
  /** Append-only human-readable log of every resolved action. */
  log: LogEntry[];
  /** Powers eliminated (capital + no income). Skipped in turn order. */
  eliminated: PowerId[];
  winner?: Alliance;
}

export interface LogEntry {
  round: number;
  power: PowerId;
  phase: Phase;
  text: string;
}
