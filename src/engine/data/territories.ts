import type { TerritoryDef } from "../types.js";

// ============================================================================
// World map — Global 1940. This is a faithful, fully-connected seed of the
// combined Europe + Pacific board: every capital, every front, sea lanes
// linking the theatres. Coordinates are an abstract 0..100 grid used by the
// SVG board (Americas far-left, Europe/Africa centre-left, USSR centre,
// Asia right, Pacific far-right, Australia bottom-right).
//
// The schema is identical to the full 150-territory board; adding the
// remaining territories is purely data entry against this same shape, and
// every engine system (movement graph, combat, income) operates generically.
// `adjacent` lists are symmetrised at load time, so a link listed on one side
// is automatically bidirectional.
// ============================================================================

const T = (
  id: string,
  display: string,
  terrain: TerritoryDef["terrain"],
  ipc: number,
  x: number,
  y: number,
  adjacent: string[],
  originalOwner?: TerritoryDef["originalOwner"],
  victoryCity?: boolean,
): TerritoryDef => ({ id, display, terrain, ipc, x, y, adjacent, originalOwner, victoryCity });

export const TERRITORIES: TerritoryDef[] = [
  // --- Americas ---------------------------------------------------------
  T("western_usa", "Western United States", "land", 10, 8, 50, ["central_usa", "sz_e_pacific", "mexico"], "UnitedStates"),
  T("central_usa", "Central United States", "land", 6, 13, 52, ["western_usa", "eastern_usa", "mexico"], "UnitedStates"),
  T("eastern_usa", "Eastern United States", "capital", 12, 18, 50, ["central_usa", "eastern_canada", "sz_w_atlantic"], "UnitedStates", true),
  T("eastern_canada", "Eastern Canada", "land", 3, 17, 38, ["eastern_usa", "sz_w_atlantic"], "UnitedKingdom"),
  T("mexico", "Mexico", "land", 2, 11, 62, ["western_usa", "central_usa", "sz_e_pacific"], "UnitedStates"),

  // --- Atlantic ---------------------------------------------------------
  T("sz_w_atlantic", "SZ Western Atlantic", "sea", 0, 25, 46, ["eastern_usa", "eastern_canada", "sz_mid_atlantic"]),
  T("sz_mid_atlantic", "SZ Mid-Atlantic", "sea", 0, 30, 52, ["sz_w_atlantic", "sz_e_atlantic", "sz_north"]),
  T("sz_e_atlantic", "SZ Eastern Atlantic", "sea", 0, 35, 58, ["sz_mid_atlantic", "sz_med", "algeria", "spain"]),

  // --- Western Europe ---------------------------------------------------
  T("sz_north", "SZ North Sea", "sea", 0, 38, 32, ["sz_mid_atlantic", "united_kingdom", "norway", "germany", "sz_baltic"]),
  T("united_kingdom", "United Kingdom", "capital", 8, 35, 38, ["sz_north", "france"], "UnitedKingdom", true),
  T("france", "France", "capital", 10, 41, 45, ["united_kingdom", "germany", "spain", "italy", "sz_med"], "France", true),
  T("spain", "Spain", "land", 2, 37, 52, ["france", "sz_e_atlantic", "algeria"]),
  T("germany", "Germany", "capital", 14, 46, 40, ["france", "norway", "poland", "italy", "sz_north", "sz_baltic"], "Germany", true),
  T("norway", "Norway", "land", 3, 44, 30, ["germany", "sz_north", "sz_baltic"]),
  T("italy", "Italy", "capital", 10, 45, 52, ["germany", "france", "balkans", "sz_med", "libya"], "Italy", true),
  T("poland", "Poland", "land", 4, 51, 40, ["germany", "baltic_states", "ukraine", "balkans"], "Germany"),
  T("balkans", "Balkans", "land", 3, 50, 48, ["italy", "poland", "ukraine"], "Germany"),
  T("baltic_states", "Baltic States", "land", 2, 53, 35, ["poland", "russia", "novgorod"], "SovietUnion"),

  // --- Mediterranean & North Africa ------------------------------------
  T("sz_med", "SZ Mediterranean", "sea", 0, 44, 58, ["italy", "france", "sz_e_atlantic", "libya", "egypt"]),
  T("algeria", "Algeria", "land", 2, 40, 64, ["spain", "sz_e_atlantic", "libya"], "France"),
  T("libya", "Libya", "land", 2, 45, 64, ["italy", "algeria", "egypt", "sz_med"], "Italy"),
  T("egypt", "Egypt", "land", 4, 51, 63, ["libya", "sz_med", "persia"], "UnitedKingdom"),

  // --- Soviet Union -----------------------------------------------------
  T("sz_baltic", "SZ Baltic", "sea", 0, 49, 33, ["germany", "norway", "sz_north", "baltic_states"]),
  T("russia", "Russia", "capital", 8, 58, 38, ["baltic_states", "ukraine", "novgorod", "caucasus"], "SovietUnion", true),
  T("novgorod", "Novgorod", "land", 2, 60, 32, ["russia", "baltic_states"], "SovietUnion"),
  T("ukraine", "Ukraine", "land", 3, 54, 46, ["poland", "balkans", "russia", "caucasus"], "SovietUnion"),
  T("caucasus", "Caucasus", "land", 4, 61, 48, ["russia", "ukraine", "persia"], "SovietUnion"),

  // --- Middle East & India ---------------------------------------------
  T("persia", "Persia", "land", 3, 65, 55, ["caucasus", "egypt", "india", "sz_indian"]),
  T("india", "India", "capital", 6, 71, 58, ["persia", "burma", "sz_indian"], "UnitedKingdom", true),
  T("burma", "Burma", "land", 2, 75, 60, ["india", "yunnan", "sz_indian"], "UnitedKingdom"),

  // --- China ------------------------------------------------------------
  T("yunnan", "Yunnan", "land", 2, 74, 54, ["burma", "szechwan", "kwangtung"], "China"),
  T("szechwan", "Szechwan", "capital", 4, 77, 51, ["yunnan", "kiangsu", "manchuria"], "China", true),
  T("kiangsu", "Kiangsu", "land", 3, 81, 50, ["szechwan", "kwangtung", "manchuria", "sz_w_pacific"], "China"),
  T("kwangtung", "Kwangtung", "land", 2, 80, 57, ["yunnan", "kiangsu", "sz_w_pacific"], "Japan"),
  T("manchuria", "Manchuria", "land", 3, 83, 44, ["szechwan", "kiangsu", "korea"], "Japan"),

  // --- Japan ------------------------------------------------------------
  T("korea", "Korea", "land", 2, 86, 45, ["manchuria", "japan", "sz_w_pacific"], "Japan"),
  T("japan", "Japan", "capital", 12, 91, 45, ["korea", "sz_w_pacific", "sz_c_pacific"], "Japan", true),

  // --- Pacific & SE Asia ------------------------------------------------
  T("sz_w_pacific", "SZ West Pacific", "sea", 0, 84, 51, ["kiangsu", "kwangtung", "korea", "japan", "philippines", "sz_c_pacific", "sz_indian"]),
  T("sz_c_pacific", "SZ Central Pacific", "sea", 0, 92, 56, ["japan", "sz_w_pacific", "caroline_islands", "sz_e_pacific", "sz_coral"]),
  T("sz_e_pacific", "SZ East Pacific", "sea", 0, 96, 50, ["sz_c_pacific", "western_usa", "mexico"]),
  T("sz_indian", "SZ Indian Ocean", "sea", 0, 70, 68, ["india", "burma", "persia", "sz_w_pacific", "east_indies"]),
  T("philippines", "Philippines", "island", 3, 86, 60, ["sz_w_pacific", "east_indies"], "UnitedStates"),
  T("east_indies", "Dutch East Indies", "island", 4, 82, 68, ["philippines", "sz_indian", "new_guinea", "sz_coral"]),
  T("caroline_islands", "Caroline Islands", "island", 1, 93, 62, ["sz_c_pacific", "new_guinea"], "Japan"),
  T("new_guinea", "New Guinea", "island", 1, 88, 72, ["east_indies", "caroline_islands", "sz_coral", "queensland"]),

  // --- Australia (ANZAC) ------------------------------------------------
  T("sz_coral", "SZ Coral Sea", "sea", 0, 92, 75, ["sz_c_pacific", "east_indies", "new_guinea", "queensland", "new_south_wales", "new_zealand"]),
  T("queensland", "Queensland", "land", 2, 86, 79, ["new_guinea", "new_south_wales", "sz_coral"], "Australia"),
  T("new_south_wales", "New South Wales", "capital", 4, 89, 86, ["queensland", "sz_coral"], "Australia", true),
  T("new_zealand", "New Zealand", "island", 2, 97, 90, ["sz_coral"], "Australia"),

  // --- Map expansion: chokepoints, depth, and outer theatres ------------
  T("iceland", "Iceland", "island", 1, 30, 27, ["sz_mid_atlantic", "sz_north"]),
  T("gibraltar", "Gibraltar", "land", 1, 37, 57, ["spain", "sz_e_atlantic", "sz_med"], "UnitedKingdom"),
  T("west_africa", "West Africa", "land", 2, 37, 71, ["algeria", "sz_e_atlantic", "south_africa", "sz_s_atlantic"], "France"),
  T("south_africa", "South Africa", "land", 3, 42, 83, ["west_africa", "sz_s_atlantic", "sz_indian"], "UnitedKingdom"),
  T("sz_s_atlantic", "SZ South Atlantic", "sea", 0, 31, 80, ["sz_e_atlantic", "west_africa", "south_africa", "brazil"]),
  T("brazil", "Brazil", "land", 2, 26, 74, ["sz_s_atlantic", "sz_e_atlantic"]),
  T("west_canada", "Western Canada", "land", 2, 12, 36, ["western_usa", "eastern_canada"], "UnitedKingdom"),
  T("kazakhstan", "Kazakhstan", "land", 2, 66, 43, ["caucasus", "russia", "persia", "siberia"], "SovietUnion"),
  T("siberia", "Siberia", "land", 2, 74, 36, ["novgorod", "kazakhstan", "manchuria"], "SovietUnion"),
  T("hawaii", "Hawaiian Islands", "island", 1, 97, 63, ["sz_c_pacific", "sz_e_pacific"], "UnitedStates", true),
];

export const TERRITORY_INDEX: Record<string, TerritoryDef> = Object.fromEntries(
  TERRITORIES.map((t) => [t.id, t]),
);

export const isSea = (id: string): boolean => TERRITORY_INDEX[id]?.terrain === "sea";
export const isLand = (id: string): boolean => {
  const t = TERRITORY_INDEX[id];
  return !!t && t.terrain !== "sea";
};
