import type { TerritoryDef } from "../types.js";

// ============================================================================
// World map — Global 1940, placed on TRUE GEOGRAPHY so it aligns with the
// photorealistic satellite-Earth background. Each territory carries a real
// (longitude, latitude); we project it equirectangularly into the 0..100 board
// space. The projection is Europe-centred (left edge ≈ 170°W) so the
// Germany / Poland / USSR front sits in the middle of the board, with the
// Americas to the west and Japan / the Pacific to the east.
//
// Projection: x = ((lon − LEFT_LON) mod 360) / 3.6 ; the ocean band spans
// y 25..75 (lat 90..−90), matching the 2:1 equirectangular Earth image.
//
// `adjacent` lists are symmetrised at load time. Adding the remaining board
// territories is data entry against this same shape.
// ============================================================================

const LEFT_LON = -170; // longitude at the left edge of the board
export const EARTH_BAND = { y: 25, height: 50 }; // where the Earth image sits
export const projectLon = (lon: number): number => (((lon - LEFT_LON) % 360) + 360) % 360 / 3.6;
export const projectLat = (lat: number): number => EARTH_BAND.y + ((90 - lat) / 180) * EARTH_BAND.height;

// (lon, lat) -> board coords
const T = (
  id: string,
  display: string,
  terrain: TerritoryDef["terrain"],
  ipc: number,
  lon: number,
  lat: number,
  adjacent: string[],
  originalOwner?: TerritoryDef["originalOwner"],
  victoryCity?: boolean,
): TerritoryDef => ({
  id, display, terrain, ipc,
  x: projectLon(lon), y: projectLat(lat),
  adjacent, originalOwner, victoryCity,
});

export const TERRITORIES: TerritoryDef[] = [
  // --- Americas ---------------------------------------------------------
  T("western_usa", "Western United States", "land", 10, -112, 40, ["central_usa", "sz_e_pacific", "mexico"], "UnitedStates"),
  T("central_usa", "Central United States", "land", 6, -95, 39, ["western_usa", "eastern_usa", "mexico"], "UnitedStates"),
  T("eastern_usa", "Eastern United States", "capital", 12, -77, 39, ["central_usa", "eastern_canada", "sz_w_atlantic"], "UnitedStates", true),
  T("eastern_canada", "Eastern Canada", "land", 3, -71, 48, ["eastern_usa", "sz_w_atlantic"], "UnitedKingdom"),
  T("west_canada", "Western Canada", "land", 2, -114, 55, ["western_usa", "eastern_canada", "alaska"], "UnitedKingdom"),
  T("alaska", "Alaska", "land", 1, -150, 63, ["west_canada", "sz_e_pacific"], "UnitedStates"),
  T("mexico", "Mexico", "land", 2, -102, 23, ["western_usa", "central_usa", "panama", "sz_e_pacific", "sz_caribbean"], "UnitedStates"),
  T("panama", "Panama", "land", 1, -80, 9, ["mexico", "sz_caribbean", "sz_e_pacific", "venezuela"], "UnitedStates"),
  T("venezuela", "Venezuela", "land", 1, -66, 7, ["sz_caribbean", "panama", "brazil", "peru"]),
  T("peru", "Peru", "land", 1, -75, -10, ["venezuela", "brazil", "argentina", "sz_se_pacific"]),
  T("brazil", "Brazil", "land", 2, -50, -10, ["venezuela", "peru", "argentina", "sz_s_atlantic", "sz_w_atlantic"]),
  T("argentina", "Argentina", "land", 2, -64, -36, ["peru", "brazil", "sz_s_atlantic", "sz_se_pacific"]),

  // --- Atlantic & Pacific seas -----------------------------------------
  T("sz_w_atlantic", "SZ Western Atlantic", "sea", 0, -50, 34, ["eastern_usa", "eastern_canada", "brazil", "sz_caribbean", "sz_mid_atlantic"]),
  T("sz_caribbean", "SZ Caribbean", "sea", 0, -73, 16, ["sz_w_atlantic", "panama", "venezuela", "mexico", "sz_e_pacific"]),
  T("sz_mid_atlantic", "SZ Mid-Atlantic", "sea", 0, -35, 33, ["sz_w_atlantic", "sz_e_atlantic", "sz_north", "sz_s_atlantic"]),
  T("sz_e_atlantic", "SZ Eastern Atlantic", "sea", 0, -18, 36, ["sz_mid_atlantic", "sz_med", "algeria", "spain", "gibraltar"]),
  T("sz_s_atlantic", "SZ South Atlantic", "sea", 0, -20, -28, ["sz_mid_atlantic", "sz_e_atlantic", "west_africa", "south_africa", "brazil", "argentina"]),
  T("sz_se_pacific", "SZ Southeast Pacific", "sea", 0, -95, -25, ["peru", "argentina", "sz_e_pacific"]),

  // --- British Isles & Western Europe ----------------------------------
  T("sz_north", "SZ North Sea", "sea", 0, 2, 57, ["sz_mid_atlantic", "united_kingdom", "norway", "holland_belgium", "denmark", "sz_baltic"]),
  T("iceland", "Iceland", "island", 1, -19, 65, ["sz_mid_atlantic", "sz_north"]),
  T("united_kingdom", "United Kingdom", "capital", 8, -2, 53, ["sz_north", "france", "sz_e_atlantic"], "UnitedKingdom", true),
  T("france", "France", "capital", 10, 2, 47, ["united_kingdom", "western_germany", "holland_belgium", "spain", "italy", "sz_med"], "France", true),
  T("spain", "Spain", "land", 2, -4, 40, ["france", "sz_e_atlantic", "gibraltar", "algeria"]),
  T("gibraltar", "Gibraltar", "land", 1, -5.5, 36, ["spain", "sz_e_atlantic", "sz_med"], "UnitedKingdom"),
  T("holland_belgium", "Holland & Belgium", "land", 2, 5, 51, ["france", "western_germany", "sz_north"], "Germany"),
  T("western_germany", "Western Germany", "land", 4, 8, 51, ["france", "holland_belgium", "germany", "greater_southern_germany"], "Germany"),
  T("germany", "Germany", "capital", 10, 13, 52.5, ["western_germany", "greater_southern_germany", "denmark", "poland", "sz_baltic"], "Germany", true),
  T("greater_southern_germany", "Greater Southern Germany", "land", 5, 13, 48.5, ["western_germany", "germany", "italy", "poland", "slovakia_hungary"], "Germany"),
  T("denmark", "Denmark", "land", 1, 10, 56, ["germany", "sz_baltic", "sz_north"], "Germany"),
  T("norway", "Norway", "land", 3, 9, 62, ["sz_north", "sz_baltic", "finland"]),
  T("italy", "Italy", "capital", 10, 12.5, 42, ["greater_southern_germany", "france", "balkans", "sz_med", "libya"], "Italy", true),

  // --- Eastern Europe & the Balkans ------------------------------------
  T("poland", "Poland", "land", 4, 19, 52, ["germany", "greater_southern_germany", "slovakia_hungary", "eastern_poland", "baltic_states"], "Germany"),
  T("eastern_poland", "Eastern Poland", "land", 2, 25, 52, ["poland", "baltic_states", "western_ukraine", "novgorod"], "SovietUnion"),
  T("slovakia_hungary", "Slovakia & Hungary", "land", 2, 19, 47.5, ["greater_southern_germany", "poland", "romania", "balkans"], "Germany"),
  T("balkans", "Balkans", "land", 3, 21, 43.5, ["italy", "slovakia_hungary", "romania", "bulgaria", "sz_med"], "Germany"),
  T("romania", "Romania", "land", 3, 25, 46, ["slovakia_hungary", "balkans", "bulgaria", "western_ukraine", "bessarabia"], "Germany"),
  T("bulgaria", "Bulgaria", "land", 1, 25, 42.5, ["balkans", "romania", "sz_med"], "Germany"),
  T("bessarabia", "Bessarabia", "land", 1, 28.5, 47.5, ["romania", "western_ukraine", "ukraine"], "SovietUnion"),
  T("baltic_states", "Baltic States", "land", 2, 25, 57, ["poland", "eastern_poland", "finland", "novgorod", "sz_baltic"], "SovietUnion"),
  T("finland", "Finland", "land", 1, 26, 63, ["norway", "baltic_states", "novgorod", "sz_baltic"], "Germany"),

  // --- Mediterranean & North Africa ------------------------------------
  T("sz_med", "SZ Mediterranean", "sea", 0, 17, 35, ["italy", "france", "balkans", "bulgaria", "sz_e_atlantic", "gibraltar", "libya", "egypt", "sz_indian"]),
  T("algeria", "Algeria", "land", 2, 2, 30, ["spain", "sz_e_atlantic", "libya"], "France"),
  T("libya", "Libya", "land", 2, 18, 27, ["italy", "algeria", "egypt", "sz_med"], "Italy"),
  T("egypt", "Egypt", "land", 4, 30, 26, ["libya", "sz_med", "trans_jordan", "anglo_sudan", "persia"], "UnitedKingdom"),
  T("west_africa", "West Africa", "land", 2, -8, 12, ["algeria", "sz_e_atlantic", "sz_s_atlantic", "congo"], "France"),
  T("congo", "Belgian Congo", "land", 2, 22, -3, ["west_africa", "anglo_sudan", "east_africa", "rhodesia"]),
  T("anglo_sudan", "Anglo-Egyptian Sudan", "land", 1, 30, 14, ["egypt", "congo", "east_africa"], "UnitedKingdom"),
  T("east_africa", "Italian East Africa", "land", 1, 42, 6, ["anglo_sudan", "congo", "rhodesia", "saudi_arabia", "sz_indian"], "Italy"),
  T("rhodesia", "Rhodesia", "land", 1, 28, -18, ["congo", "east_africa", "south_africa"], "UnitedKingdom"),
  T("south_africa", "South Africa", "land", 3, 24, -30, ["rhodesia", "west_africa", "sz_s_atlantic", "sz_indian"], "UnitedKingdom"),

  // --- Soviet Union -----------------------------------------------------
  T("sz_baltic", "SZ Baltic", "sea", 0, 19, 58, ["germany", "denmark", "norway", "finland", "baltic_states", "sz_north"]),
  T("russia", "Russia", "capital", 8, 38, 56, ["novgorod", "ukraine", "samara", "caucasus"], "SovietUnion", true),
  T("novgorod", "Novgorod", "land", 2, 33, 59, ["russia", "baltic_states", "finland", "eastern_poland", "archangel"], "SovietUnion"),
  T("ukraine", "Ukraine", "land", 3, 33, 49, ["western_ukraine", "bessarabia", "russia", "caucasus"], "SovietUnion"),
  T("western_ukraine", "Western Ukraine", "land", 2, 27, 49.5, ["eastern_poland", "ukraine", "romania", "bessarabia"], "SovietUnion"),
  T("caucasus", "Caucasus", "land", 4, 45, 43, ["russia", "ukraine", "samara", "kazakhstan", "iraq", "persia"], "SovietUnion"),
  T("archangel", "Archangel", "land", 2, 42, 64, ["novgorod", "samara", "siberia"], "SovietUnion"),
  T("samara", "Samara", "land", 2, 50, 53, ["russia", "caucasus", "archangel", "urals", "kazakhstan"], "SovietUnion"),
  T("urals", "Urals", "land", 1, 60, 57, ["samara", "archangel", "siberia", "novosibirsk"], "SovietUnion"),
  T("kazakhstan", "Kazakhstan", "land", 2, 67, 48, ["caucasus", "samara", "persia", "novosibirsk"], "SovietUnion"),
  T("novosibirsk", "Novosibirsk", "land", 1, 83, 55, ["urals", "kazakhstan", "siberia", "soviet_far_east", "manchuria"], "SovietUnion"),
  T("siberia", "Siberia", "land", 2, 100, 64, ["archangel", "urals", "novosibirsk", "soviet_far_east"], "SovietUnion"),
  T("soviet_far_east", "Soviet Far East", "land", 1, 132, 53, ["siberia", "novosibirsk", "manchuria", "sz_w_pacific"], "SovietUnion"),

  // --- Middle East & India ---------------------------------------------
  T("trans_jordan", "Trans-Jordan", "land", 1, 37, 31, ["egypt", "iraq", "saudi_arabia"], "UnitedKingdom"),
  T("iraq", "Iraq", "land", 1, 44, 33, ["trans_jordan", "persia", "saudi_arabia", "caucasus"]),
  T("saudi_arabia", "Saudi Arabia", "land", 1, 45, 24, ["trans_jordan", "iraq", "east_africa", "sz_indian"]),
  T("persia", "Persia", "land", 3, 53, 32, ["caucasus", "iraq", "egypt", "kazakhstan", "india", "sz_indian"]),
  T("india", "India", "capital", 6, 79, 22, ["persia", "burma", "sz_indian"], "UnitedKingdom", true),
  T("burma", "Burma", "land", 2, 96, 21, ["india", "yunnan", "siam", "sz_indian"], "UnitedKingdom"),

  // --- China ------------------------------------------------------------
  T("yunnan", "Yunnan", "land", 2, 101, 25, ["burma", "szechwan", "kwangtung", "french_indochina"], "China"),
  T("szechwan", "Szechwan", "capital", 4, 104, 30, ["yunnan", "kiangsu", "manchuria"], "China", true),
  T("kiangsu", "Kiangsu", "land", 3, 119, 32, ["szechwan", "kwangtung", "manchuria", "sz_w_pacific"], "China"),
  T("kwangtung", "Kwangtung", "land", 2, 113, 23, ["yunnan", "kiangsu", "french_indochina", "formosa", "sz_w_pacific"], "Japan"),
  T("manchuria", "Manchuria", "land", 3, 125, 45, ["szechwan", "kiangsu", "korea", "novosibirsk", "soviet_far_east"], "Japan"),

  // --- Japan & the home islands ----------------------------------------
  T("korea", "Korea", "land", 2, 128, 38, ["manchuria", "japan", "sz_w_pacific"], "Japan"),
  T("japan", "Japan", "capital", 12, 138, 36, ["korea", "okinawa", "sz_w_pacific", "sz_c_pacific"], "Japan", true),
  T("formosa", "Formosa", "island", 1, 121, 23.5, ["sz_w_pacific", "kwangtung"], "Japan"),
  T("okinawa", "Okinawa", "island", 1, 128, 26, ["sz_w_pacific", "japan"], "Japan"),

  // --- SE Asia & the Dutch East Indies ----------------------------------
  T("french_indochina", "French Indochina", "land", 2, 106, 16, ["yunnan", "kwangtung", "siam", "sz_w_pacific"], "France"),
  T("siam", "Siam", "land", 1, 100, 15, ["burma", "french_indochina", "malaya"]),
  T("malaya", "Malaya", "land", 1, 102, 4, ["siam", "sumatra", "sz_indian", "sz_w_pacific"], "UnitedKingdom"),
  T("sumatra", "Sumatra", "island", 1, 101, 0, ["malaya", "java", "east_indies", "sz_indian"]),
  T("java", "Java", "island", 1, 110, -7, ["sumatra", "east_indies", "sz_coral"]),
  T("borneo", "Borneo", "island", 1, 114, 0, ["east_indies", "celebes", "sz_w_pacific"]),
  T("celebes", "Celebes", "island", 1, 121, -2, ["borneo", "east_indies", "new_guinea"]),
  T("east_indies", "Dutch East Indies", "island", 4, 128, -3, ["philippines", "celebes", "borneo", "sz_indian", "new_guinea", "sz_coral"]),
  T("philippines", "Philippines", "island", 3, 122, 13, ["sz_w_pacific", "east_indies"], "UnitedStates"),

  // --- Indian Ocean & the Pacific --------------------------------------
  T("sz_indian", "SZ Indian Ocean", "sea", 0, 75, -10, ["india", "burma", "persia", "saudi_arabia", "east_africa", "south_africa", "malaya", "sumatra", "sz_med", "sz_w_pacific"]),
  T("sz_w_pacific", "SZ West Pacific", "sea", 0, 130, 22, ["kiangsu", "kwangtung", "korea", "japan", "formosa", "okinawa", "philippines", "french_indochina", "soviet_far_east", "sz_c_pacific", "sz_indian"]),
  T("sz_c_pacific", "SZ Central Pacific", "sea", 0, 165, 14, ["japan", "sz_w_pacific", "marianas", "caroline_islands", "midway", "hawaii", "sz_e_pacific", "sz_coral"]),
  T("sz_e_pacific", "SZ East Pacific", "sea", 0, -140, 18, ["sz_c_pacific", "hawaii", "alaska", "western_usa", "mexico", "panama", "sz_caribbean", "sz_se_pacific"]),
  T("caroline_islands", "Caroline Islands", "island", 1, 150, 7, ["sz_c_pacific", "marianas", "new_guinea"], "Japan"),
  T("marianas", "Marianas", "island", 1, 145, 16, ["sz_c_pacific", "sz_w_pacific", "caroline_islands"], "Japan"),
  T("new_guinea", "New Guinea", "island", 1, 143, -5, ["east_indies", "celebes", "caroline_islands", "solomons", "sz_coral", "queensland"]),
  T("midway", "Midway", "island", 0, -177, 28, ["sz_c_pacific"], "UnitedStates"),
  T("hawaii", "Hawaiian Islands", "island", 1, -157, 21, ["sz_c_pacific", "sz_e_pacific"], "UnitedStates", true),

  // --- Australia (ANZAC) & the South Pacific ----------------------------
  T("sz_coral", "SZ Coral Sea", "sea", 0, 158, -18, ["sz_c_pacific", "east_indies", "java", "new_guinea", "solomons", "queensland", "new_south_wales", "fiji", "new_zealand"]),
  T("queensland", "Queensland", "land", 2, 145, -22, ["new_guinea", "new_south_wales", "sz_coral"], "Australia"),
  T("new_south_wales", "New South Wales", "capital", 4, 149, -33, ["queensland", "sz_coral"], "Australia", true),
  T("new_zealand", "New Zealand", "island", 2, 174, -41, ["sz_coral"], "Australia"),
  T("solomons", "Solomon Islands", "island", 1, 160, -9, ["sz_coral", "new_guinea"]),
  T("fiji", "Fiji", "island", 1, 178, -17, ["sz_coral"]),
];

export const TERRITORY_INDEX: Record<string, TerritoryDef> = Object.fromEntries(
  TERRITORIES.map((t) => [t.id, t]),
);

export const isSea = (id: string): boolean => TERRITORY_INDEX[id]?.terrain === "sea";
export const isLand = (id: string): boolean => {
  const t = TERRITORY_INDEX[id];
  return !!t && t.terrain !== "sea";
};

/**
 * Canals: a sea passage between two zones that may only be traversed by a power
 * friendly with the controller of the gate territory (Suez & Panama).
 */
export interface Canal {
  between: [string, string];
  gate: string;
}
export const CANALS: Canal[] = [
  { between: ["sz_med", "sz_indian"], gate: "egypt" }, // Suez
  { between: ["sz_caribbean", "sz_e_pacific"], gate: "panama" }, // Panama
];

/** If the edge a–b is a canal, return the gate territory id; else null. */
export function canalGate(a: string, b: string): string | null {
  for (const c of CANALS) {
    if ((c.between[0] === a && c.between[1] === b) || (c.between[0] === b && c.between[1] === a)) return c.gate;
  }
  return null;
}
