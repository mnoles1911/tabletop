import type { PowerDef, PowerId } from "../types.js";

// ============================================================================
// The nine powers. Turn order follows the Global 1940 sequence of play:
// Germany, Soviet Union, Japan, United States, China, United Kingdom, Italy,
// ANZAC (Australia), France. Starting IPC totals match the 2nd-edition setup.
// ============================================================================

export const POWERS: Record<PowerId, PowerDef> = {
  Germany: {
    id: "Germany",
    display: "Germany",
    alliance: "Axis",
    color: "#5a5a5a",
    capital: "germany",
    startingIPC: 30,
    turnOrder: 0,
  },
  SovietUnion: {
    id: "SovietUnion",
    display: "Soviet Union",
    alliance: "Allies",
    color: "#b13a3a",
    capital: "russia",
    startingIPC: 37,
    turnOrder: 1,
  },
  Japan: {
    id: "Japan",
    display: "Japan",
    alliance: "Axis",
    color: "#c9a23a",
    capital: "japan",
    startingIPC: 26,
    turnOrder: 2,
  },
  UnitedStates: {
    id: "UnitedStates",
    display: "United States",
    alliance: "Allies",
    color: "#3a7a4a",
    capital: "eastern_united_states",
    startingIPC: 52,
    turnOrder: 3,
  },
  China: {
    id: "China",
    display: "China",
    alliance: "Allies",
    color: "#d98a3a",
    capital: "szechwan",
    startingIPC: 12,
    turnOrder: 4,
  },
  UnitedKingdom: {
    id: "UnitedKingdom",
    display: "United Kingdom",
    alliance: "Allies",
    color: "#8a6d3a",
    capital: "united_kingdom",
    startingIPC: 28,
    turnOrder: 5,
  },
  Italy: {
    id: "Italy",
    display: "Italy",
    alliance: "Axis",
    color: "#3a7a8a",
    capital: "southern_italy",
    startingIPC: 10,
    turnOrder: 6,
  },
  Australia: {
    id: "Australia",
    display: "ANZAC",
    alliance: "Allies",
    color: "#6d8a3a",
    capital: "new_south_wales",
    startingIPC: 10,
    turnOrder: 7,
  },
  France: {
    id: "France",
    display: "France",
    alliance: "Allies",
    color: "#3a5a8a",
    capital: "france",
    startingIPC: 19,
    turnOrder: 8,
  },
  // Not a playable power — it simply owns the garrisons of neutral countries so
  // they defend when invaded. Enemy of everyone, allied to none, never plays a
  // turn (excluded from TURN_ORDER below).
  Neutral: {
    id: "Neutral",
    display: "Neutral",
    alliance: "Neutral",
    color: "#8c8c8c",
    capital: "",
    startingIPC: 0,
    turnOrder: 99,
  },
};

export const TURN_ORDER: PowerId[] = Object.values(POWERS)
  .filter((p) => p.id !== "Neutral")
  .sort((a, b) => a.turnOrder - b.turnOrder)
  .map((p) => p.id);

export const powerDef = (id: PowerId): PowerDef => POWERS[id];

export const areAllied = (a: PowerId, b: PowerId): boolean =>
  POWERS[a].alliance === POWERS[b].alliance;

export const areEnemies = (a: PowerId, b: PowerId): boolean =>
  POWERS[a].alliance !== POWERS[b].alliance;
