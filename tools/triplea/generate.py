#!/usr/bin/env python3
"""
Generate the engine's map data from the open-source TripleA `world_war_ii_global`
map (game: World War II Global 1940 2nd Edition).

Source files (committed alongside this script under tools/triplea/):
  - ww2global40_2nd_edition.xml : territories, connections, production,
        ownership, victory cities, capitals, canals, starting unit placement
  - centers.txt                 : per-territory label anchor (board pixels)
  - polygons.txt                : per-territory outline polygons (board pixels)

Why this exists: hand-transcribing 333 territories + 840 adjacencies is error
prone. TripleA encodes the *exact* board as data, so we derive our data files
from it. We render our own styling over the geometry — only the factual
coordinate/adjacency data is used, never TripleA's artwork.

Outputs (TypeScript, checked in):
  - src/engine/data/territories.ts     : TERRITORIES[] + CANALS + helpers
  - src/engine/data/borders.ts         : BORDERS map (sphere-ready lon/lat rings)
  - src/engine/data/setup.generated.ts : STARTING_FORCES placements

The board is a single wrapped (~360deg) world image, so board pixels project to
geographic-ish lon/lat by an equirectangular fit (calibrated against real
geography). Provinces keep their true relative positions; the globe renderer
wraps these lon/lat rings onto a sphere, so the historic A&A outlines overlap
exactly as on the board.

Run:  python3 tools/triplea/generate.py
"""
import re
import os
import json

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DATA = os.path.join(ROOT, "src", "engine", "data")
XML = os.path.join(HERE, "ww2global40_2nd_edition.xml")
CENTERS = os.path.join(HERE, "centers.txt")
POLYS = os.path.join(HERE, "polygons.txt")

# Board image dimensions + equirectangular fit (calibrated vs real geography).
W, H = 7705, 3213
LON_OFF = -108.6                 # lon = px / W * 360 + LON_OFF  (continuous, no wrap)
LAT_A, LAT_B = 71.8, -0.03288    # lat = LAT_A + LAT_B * py

PIX_TOL = 6.0                    # Douglas-Peucker simplification tolerance (board px)

# TripleA player -> our PowerId. Sub-economies fold into their parent power;
# the three neutral classes have no owner in our (no-neutral-power) engine yet.
OWNER = {
    "Germans": "Germany", "Russians": "SovietUnion", "Japanese": "Japan",
    "Americans": "UnitedStates", "Chinese": "China", "British": "UnitedKingdom",
    "UK_Pacific": "UnitedKingdom", "Italians": "Italy", "ANZAC": "Australia",
    "French": "France", "Dutch": "UnitedKingdom", "Mongolians": "SovietUnion",
}
UNIT = {
    "aaGun": "aa_gun", "airfield": "air_base", "armour": "tank",
    "artillery": "artillery", "battleship": "battleship", "bomber": "strategic_bomber",
    "carrier": "aircraft_carrier", "cruiser": "cruiser", "destroyer": "destroyer",
    "factory_major": "major_ic", "factory_minor": "minor_ic", "fighter": "fighter",
    "harbour": "naval_base", "infantry": "infantry", "mech_infantry": "mech_infantry",
    "submarine": "submarine", "tactical_bomber": "tactical_bomber", "transport": "transport",
}


def slug(name):
    m = re.match(r"^(\d+) Sea Zone$", name)
    if m:
        return "sz_" + m.group(1)
    s = name.lower()
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s


def ts_str(value):
    return json.dumps(value, ensure_ascii=False)


def project(px, py):
    lon = px / W * 360.0 + LON_OFF
    lat = LAT_A + LAT_B * py
    return round(lon, 3), round(lat, 3)


def dp(points, tol):
    """Douglas-Peucker polyline simplification on (x,y) pixel points."""
    if len(points) < 3:
        return points
    dmax, idx = 0.0, 0
    ax, ay = points[0]
    bx, by = points[-1]
    ex, ey = bx - ax, by - ay
    norm = (ex * ex + ey * ey) ** 0.5 or 1.0
    for i in range(1, len(points) - 1):
        px, py = points[i]
        d = abs((px - ax) * ey - (py - ay) * ex) / norm
        if d > dmax:
            dmax, idx = d, i
    if dmax > tol:
        return dp(points[:idx + 1], tol)[:-1] + dp(points[idx:], tol)
    return [points[0], points[-1]]


# --- parse XML -------------------------------------------------------------
xml = open(XML).read()

water = set(re.findall(r'<territory name="([^"]+)"\s+water="true"', xml))
all_terr = re.findall(r'<territory name="([^"]+)"', xml)

conns = re.findall(r'<connection t1="([^"]+)" t2="([^"]+)"', xml)

attach_blocks = re.findall(
    r'<attachment[^>]*name="territoryAttachment"[^>]*attachTo="([^"]+)"[^>]*>(.*?)</attachment>',
    xml, re.S)
production, victory = {}, set()
for terr, body in attach_blocks:
    mp = re.search(r'name="production" value="(\d+)"', body)
    if mp:
        production[terr] = int(mp.group(1))
    if "victoryCity" in body:
        victory.add(terr)

owners = dict(re.findall(r'<territoryOwner territory="([^"]+)" owner="([^"]+)"', xml))

placements = re.findall(
    r'<unitPlacement unitType="([^"]+)" territory="([^"]+)" quantity="(\d+)"(?:\s+owner="([^"]+)")?',
    xml)

# canals: key -> {seas:set, land:[gate territories]}
canals = {}
for m in re.finditer(
        r'<attachment name="canalAttachment(\w+)" attachTo="([^"]+)"[^>]*>(.*?)</attachment>',
        xml, re.S):
    key, sea, body = m.group(1), m.group(2), m.group(3)
    land = re.search(r'name="landTerritories" value="([^"]+)"', body)
    c = canals.setdefault(key, {"seas": set(), "land": []})
    c["seas"].add(sea)
    if land and not c["land"]:
        c["land"] = land.group(1).split(":")

# --- centers & polygons ----------------------------------------------------
centers = {}
for line in open(CENTERS):
    m = re.match(r"(.+?)\s+\((\d+),(\d+)\)", line.strip())
    if m:
        centers[m.group(1)] = (int(m.group(2)), int(m.group(3)))

borders = {}
for line in open(POLYS):
    line = line.rstrip("\n")
    if not line.strip():
        continue
    name, _, rest = line.partition("  <")
    name = name.strip()
    rings = []
    for chunk in ("<" + rest).split("<"):
        pts = re.findall(r"\((\d+),(\d+)\)", chunk)
        if len(pts) >= 3:
            ring = dp([(int(x), int(y)) for x, y in pts], PIX_TOL)
            if len(ring) >= 3:
                rings.append(ring)
    if rings:
        borders[name] = rings

# --- adjacency -------------------------------------------------------------
adj = {t: set() for t in all_terr}
for a, b in conns:
    if a in adj and b in adj:
        adj[a].add(b)
        adj[b].add(a)

# --- emit territories.ts ---------------------------------------------------
terr_lines = []
for name in all_terr:
    sid = slug(name)
    terrain = "sea" if name in water else "land"
    ipc = production.get(name, 0)
    owner = OWNER.get(owners.get(name, ""))
    px, py = centers.get(name, (0, 0))
    lon, lat = project(px, py)
    nbrs = sorted(slug(n) for n in adj.get(name, ()))
    parts = [f'id: "{sid}"', f'display: {ts_str(name)}', f'terrain: "{terrain}"', f'ipc: {ipc}']
    if owner:
        parts.append(f'originalOwner: "{owner}"')
    if name in victory:
        parts.append("victoryCity: true")
    parts.append(f'lon: {lon}, lat: {lat}, x: {round(px / W * 100, 2)}, y: {round(py / H * 100, 2)}')
    parts.append("adjacent: [" + ", ".join(f'"{n}"' for n in nbrs) + "]")
    terr_lines.append("  { " + ", ".join(parts) + " },")

canal_lines = []
for key, c in sorted(canals.items()):
    seas = sorted(slug(s) for s in c["seas"])
    gates = [slug(g) for g in c["land"]]
    if len(seas) == 2 and gates:
        canal_lines.append(
            '  { between: ["%s", "%s"], gates: [%s], name: "%s" },'
            % (seas[0], seas[1], ", ".join(f'"{g}"' for g in gates), key))

territories_ts = '''import type { TerritoryDef } from "../types.js";

// ============================================================================
// GENERATED FILE — do not edit by hand. Run `python3 tools/triplea/generate.py`.
//
// The complete Global 1940 2nd Edition board, derived from the open-source
// TripleA `world_war_ii_global` map: every territory and sea zone, exact
// adjacency (the `<connection>` graph), IPC production, starting ownership,
// victory cities and canals. Province outlines live in `borders.ts`.
//
// `lon`/`lat` are an equirectangular projection of the board so the globe
// renderer can wrap the real A&A province shapes onto a sphere; `x`/`y` are a
// 0..100 board-space fallback for the flat view.
// ============================================================================

export const TERRITORIES: TerritoryDef[] = [
%s
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
 * Canals: a sea passage between two sea zones that may only be traversed while
 * every `gates` land territory is controlled by a power friendly to the mover
 * (Suez, Panama, Gibraltar, the Turkish Straits and the Danish Straits).
 */
export interface Canal {
  between: [string, string];
  gates: string[];
  name: string;
}
export const CANALS: Canal[] = [
%s
];

/** If the edge a-b is a canal, return its gate territory ids; else null. */
export function canalGates(a: string, b: string): string[] | null {
  for (const c of CANALS) {
    if ((c.between[0] === a && c.between[1] === b) || (c.between[0] === b && c.between[1] === a)) {
      return c.gates;
    }
  }
  return null;
}

/** Back-compat: first gate territory of a canal edge, or null. */
export function canalGate(a: string, b: string): string | null {
  const g = canalGates(a, b);
  return g ? g[0] : null;
}
''' % ("\n".join(terr_lines), "\n".join(canal_lines))

open(os.path.join(DATA, "territories.ts"), "w").write(territories_ts)

# --- emit borders.ts -------------------------------------------------------
border_lines = []
for name in all_terr:
    sid = slug(name)
    rings = borders.get(name, [])
    out_rings = []
    for ring in rings:
        pts = [list(project(px, py)) for px, py in ring]
        out_rings.append(pts)
    border_lines.append(f'  "{sid}": {json.dumps(out_rings)},')

borders_ts = '''// ============================================================================
// GENERATED FILE — do not edit by hand. Run `python3 tools/triplea/generate.py`.
//
// Province outlines for every territory, as one or more rings of [lon, lat]
// points (degrees). Derived from the TripleA board polygons and projected with
// the same equirectangular fit as `territories.ts`, so the globe renderer can
// wrap the real A&A province shapes onto the sphere. Sea zones included.
// ============================================================================

/** territory id -> array of rings; each ring is an array of [lon, lat]. */
export const BORDERS: Record<string, [number, number][][]> = {
%s
};
''' % ("\n".join(border_lines))

open(os.path.join(DATA, "borders.ts"), "w").write(borders_ts)

# --- emit setup.generated.ts (starting placement) --------------------------
# group: territory -> { (unit, owner): count }
grouped = {}
order = []
for utype, terr, qty, owner in placements:
    # Neutral-country garrisons are owned by the synthetic "Neutral" power so
    # they defend when invaded; everything else maps to its parent power.
    if owner and owner.startswith("Neutral"):
        powner = "Neutral"
    else:
        powner = OWNER.get(owner) if owner else None
    sid = slug(terr)
    uid = UNIT.get(utype)
    if not uid:
        continue
    if sid not in grouped:
        grouped[sid] = {}
        order.append(sid)
    key = (uid, powner)
    grouped[sid][key] = grouped[sid].get(key, 0) + int(qty)

setup_lines = []
for sid in order:
    units = grouped[sid]
    parts = []
    for (uid, powner), cnt in units.items():
        if powner:
            parts.append(f'["{uid}", {cnt}, "{powner}"]')
        else:
            parts.append(f'["{uid}", {cnt}]')
    setup_lines.append(f'  ["{sid}", [{", ".join(parts)}]],')

setup_ts = '''import type { PowerId, UnitTypeId } from "../types.js";

// ============================================================================
// GENERATED FILE — do not edit by hand. Run `python3 tools/triplea/generate.py`.
//
// The official 1940 2nd Edition starting placement, derived from the TripleA
// setup. Each row is [territory, [[unitType, count, owner?], ...]]. Owner is
// explicit because fleets and expeditionary units often differ from the
// territory's controller. Neutral-country garrisons are owned by the synthetic
// "Neutral" power so invading them triggers a real defensive battle.
// ============================================================================

export type Placement = [territory: string, units: Array<[UnitTypeId, number, PowerId?]>];

export const STARTING_FORCES: Placement[] = [
%s
];
''' % ("\n".join(setup_lines))

open(os.path.join(DATA, "setup.generated.ts"), "w").write(setup_ts)

print("territories:", len(all_terr), "(sea:", len(water), ")")
print("connections:", len(conns), "adjacency nodes:", len(adj))
print("borders:", len(borders), "canals:", len(canal_lines))
print("placement rows:", len(setup_lines))
print("wrote territories.ts, borders.ts, setup.generated.ts")
