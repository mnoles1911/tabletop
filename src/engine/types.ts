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
  | "France"
  | "Neutral"; // owns neutral-country garrisons; never takes a turn

export type Alliance = "Axis" | "Allies" | "Neutral";

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
  | "minor_ic" // minor industrial complex
  | "air_base" // extends air range, enables scramble
  | "naval_base"; // extends sea range, repairs ships

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
  | "factory" // industrial complex (produces units, can be strat-bombed)
  | "air_base" // extends air range / enables scramble
  | "naval_base"; // extends sea range

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
  /** Layout position for the 2D SVG board (projected grid coords, 0..100). */
  x: number;
  y: number;
  /** True geographic position, used by the 3D globe renderer. */
  lon: number;
  lat: number;
  /** Victory city — relevant to the global victory conditions. */
  victoryCity?: boolean;
  /** Neutral bloc, if this is a neutral country: strict, pro-Axis or pro-Allied. */
  neutral?: "true" | "axis" | "allies";
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
  /** Sea zone whose warships provide shore bombardment for an amphibious assault. */
  bombardFrom?: string;
  /** A strategic bombing raid rather than a ground/sea battle. */
  sbr?: boolean;
  /** True once opening fire (AA / sub surprise / bombardment) has been applied. */
  started?: boolean;
  /** Regular combat rounds fought so far (for round-by-round resolution). */
  roundsFought?: number;
  /** Attacker hits awaiting manual casualty assignment (interactive play). */
  pendingAttackerHits?: number;
  /** The most recent round's dice, surfaced to the UI. */
  lastRound?: {
    attackerRolls: number[];
    defenderRolls: number[];
    attackerHits: number;
    defenderHits: number;
    notes: string[];
  };
  /** Aircraft scrambled to defend this sea battle, to be returned afterwards. */
  scrambled?: { from: string; type: UnitTypeId; count: number; owner: PowerId }[];
}

/** House rules & optional systems chosen at game creation. */
export interface GameOptions {
  /** Low Luck: convert pips to guaranteed hits + one rounding roll. */
  lowLuck: boolean;
  /** Grant National Objective income bonuses. */
  nationalObjectives: boolean;
  /** Enable the research & development spend (tech). */
  research: boolean;
  /** Victory: hold all enemy capitals, or N victory cities. */
  victory: { mode: "capitals" | "cities"; cities: number };
}

export const DEFAULT_OPTIONS: GameOptions = {
  lowLuck: false,
  nationalObjectives: true,
  research: false,
  victory: { mode: "capitals", cities: 0 },
};

export interface CombatState {
  battles: PendingBattle[];
  /** Territory whose battle dialog is currently open on the active client. */
  active?: string;
}

export interface GameState {
  schema: 1;
  /** Monotonic version; the server rejects stale-version actions. */
  version: number;
  /** House rules selected for this game. */
  options: GameOptions;
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
  /** Transport capacity already used this turn, keyed by sea zone. */
  transportUse: Record<string, number>;
  /** Units already mobilized this turn per factory territory (capacity limit). */
  placement: Record<string, number>;
  /** Technologies developed per power (research option). */
  tech: Record<string, TechId[]>;
  /** Japan's remaining kamikaze tokens (Pacific island defence). */
  kamikaze?: number;
  /** Neutral blocs that have already been swung into the war. */
  neutralsActivated?: ("true" | "axis" | "allies")[];
  winner?: Alliance;
}

export type TechId =
  | "jet_fighters" // fighters defend on 5
  | "heavy_bombers" // strategic bombers roll 2 dice, keep best
  | "super_subs" // submarines attack on 3
  | "improved_shipyards" // (flavour) cheaper repairs — tracked, light effect
  | "war_bonds" // +1d6 IPC each turn
  | "increased_factory"; // +2 production capacity at each factory

export const ALL_TECHS: TechId[] = [
  "jet_fighters",
  "heavy_bombers",
  "super_subs",
  "improved_shipyards",
  "war_bonds",
  "increased_factory",
];

export const TECH_NAMES: Record<TechId, string> = {
  jet_fighters: "Jet Fighters",
  heavy_bombers: "Heavy Bombers",
  super_subs: "Super Submarines",
  improved_shipyards: "Improved Shipyards",
  war_bonds: "War Bonds",
  increased_factory: "Increased Factory Production",
};

export interface LogEntry {
  round: number;
  power: PowerId;
  phase: Phase;
  text: string;
}
