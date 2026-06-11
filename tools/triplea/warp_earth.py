#!/usr/bin/env python3
"""
warp_earth.py — Warp the equirectangular satellite texture into "board space".

Why this exists
---------------
The 3D globe renders `src/client/public/earth_day.jpg` (2048x1024 equirectangular
satellite image) on a sphere, with the Axis & Allies province outlines (from
`src/engine/data/borders.ts`) wrapped on top using a *linear* equirectangular
fit (see `generate.py`):

    lon = px / W * 360 + LON_OFF        (W=7705, LON_OFF=-108.6)
    lat = LAT_A + LAT_B * py            (LAT_A=71.8, LAT_B=-0.03288)

But the hand-drawn TripleA board is NOT a linear equirectangular projection of
the real earth — it is roughly Mercator-ish in latitude and has stylized,
enlarged regions (notably Europe). So real satellite coastlines do not line up
with the province outlines.

This script regenerates `earth_day.jpg` (same name, 2048x1024, jpg q~85) so that
when it is displayed with the existing *linear* mapping, real coastlines fall
where the board's territory outlines are.

Pipeline
--------
1. Control points: a hardcoded table of LAND territory names (spelled exactly as
   in centers.txt) -> real-world (lat, lon) centroid. Board pixel comes from
   centers.txt.
2. Fit the board's TRUE projection P:(px,py)->(lon,lat):
     - longitude: least-squares linear in px (continuous frame, no wrap),
     - latitude: inverse-Mercator lat(py)=2*atan(exp((y0-py)/s))-pi/2, fit by
       coordinate descent; linear lat kept as fallback (lower-RMS wins),
     - residual field: Gaussian RBF over per-control-point residuals to capture
       regional stylization.
3. For every output pixel we know its linear-frame (lon_lin,lat_lin); invert the
   linear map to a board pixel (px,py), apply P to get the real (lon,lat), and
   bilinearly sample the ORIGINAL image there. Outside the board's lat range we
   blend to identity so the poles stay correct.
4. Write /tmp/warp_check.png (after) and /tmp/warp_check_before.png with the
   province rings drawn in red using the renderer's exact UV mapping.

Compositing stage (added) — make coastlines EXACTLY the board's coastlines
------------------------------------------------------------------------
The warp above brings real coastlines *close* to the province rings, but a hand
drawn board can never coincide with real satellite coastlines. So after warping
we re-cut the texture so the land/sea boundary in the pixels IS the board's:

5. Rasterize a LAND MASK at OUT res (supersampled SS=2x then box-downsampled for
   antialiased edges) by filling the polygon rings of every LAND territory.
   Territory terrain ("land"/"sea") comes from territories.ts; the rings come
   from borders.ts keyed by territory id. Lon wrap (rings up to ~+250 deg in the
   Pacific) is handled by drawing each ring at its base lon and at +-360 shifts
   so seam-crossing polygons fill correctly. Sea zones are NOT filled, so inland
   seas enclosed by land territories (Caspian, Black Sea, etc.) correctly read as
   water because no land ring covers them.

6. Composite:
   - INSIDE the land mask: the warped satellite sample, but where that sample is
     obviously water (b>r and b>g, or low luminance) it is replaced by a heavily
     blurred "land color" field (built from only the non-water warped pixels) so
     ocean never shows inside a province whose board shape is bigger than the
     real land.
   - OUTSIDE the land mask: ocean. Real water is kept; real land poking past the
     board coastline is overwritten with deep ocean blue (#13456e) blended with
     the local satellite water tone so it is not flat.
   - The supersampled mask gives a soft 1-2px antialiased coastline.

7. Regenerate earth_day.jpg, plus /tmp/warp_check2.png (composited + red rings)
   and crops /tmp/fit_europe.png, /tmp/fit_pacific.png, /tmp/fit_americas.png.

Re-runnable: the original texture is preserved as earth_day_src.jpg on first run
and always sampled from that copy. A single run does warp + composite.

Run:  python3 tools/triplea/warp_earth.py
"""
import os
import re
import math
import json
import shutil
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
CENTERS = os.path.join(HERE, "centers.txt")
BORDERS_TS = os.path.join(ROOT, "src", "engine", "data", "borders.ts")
TERRITORIES_TS = os.path.join(ROOT, "src", "engine", "data", "territories.ts")
EARTH_OUT = os.path.join(ROOT, "src", "client", "public", "earth_day.jpg")
EARTH_SRC = os.path.join(HERE, "earth_day_src.jpg")

# Compositing stage constants.
SS = 2                             # supersample factor for the land mask
DEEP_OCEAN = np.array([0x13, 0x45, 0x6e], np.float32)  # #13456e deep ocean blue

# Board / linear-fit constants (must match generate.py).
W, H = 7705, 3213
LON_OFF = -108.6
LAT_A, LAT_B = 71.8, -0.03288

OUT_W, OUT_H = 2048, 1024
RBF_SIGMA = 900.0          # board px; smoothness of the residual field
RBF_REG = 0.15             # regularization (relative) so isolated points don't spike
RESID_CAP = 12.0           # deg; cap residual magnitude to avoid wild extrapolation
EDGE_BLEND_DEG = 4.0       # deg band over which to blend to identity past board edges

# --------------------------------------------------------------------------
# Control points: territory name (exactly as in centers.txt) -> (lat, lon).
# Real-world approximate centroids. Well distributed; land only.
# --------------------------------------------------------------------------
CONTROL = {
    # --- Europe (dense) ---
    "United Kingdom": (52.5, -1.5),
    "Scotland": (56.8, -4.2),
    "Eire": (53.3, -8.0),
    "France": (48.0, 2.5),
    "Normandy Bordeaux": (46.5, -0.5),
    "Southern France": (44.0, 4.5),
    "Spain": (40.3, -3.7),
    "Portugal": (39.6, -8.0),
    "Gibraltar": (36.1, -5.3),
    "Holland Belgium": (51.5, 4.5),
    "Denmark": (56.0, 9.5),
    "Germany": (52.5, 13.4),
    "Western Germany": (50.5, 8.0),
    "Greater Southern Germany": (48.5, 11.5),
    "Switzerland": (46.8, 8.2),
    "Northern Italy": (45.4, 9.5),
    "Southern Italy": (41.0, 15.0),
    "Sicily": (37.5, 14.2),
    "Sardinia": (40.0, 9.0),
    "Norway": (62.0, 9.0),
    "Sweden": (62.0, 15.0),
    "Finland": (64.0, 26.0),
    "Poland": (52.2, 20.0),
    "Eastern Poland": (52.0, 23.0),
    "Slovakia Hungary": (47.5, 18.5),
    "Romania": (45.9, 25.0),
    "Bulgaria": (42.7, 25.3),
    "Greece": (39.0, 22.0),
    "Yugoslavia": (44.0, 19.5),
    "Albania": (41.0, 20.0),
    "Crete": (35.2, 24.9),
    "Bessarabia": (47.0, 28.5),
    "Baltic States": (56.8, 24.5),
    "Ukraine": (49.0, 31.0),
    "Western Ukraine": (50.5, 26.0),
    "Belarus": (53.7, 27.9),
    "Iceland": (64.9, -19.0),
    # --- Western Soviet / Russia ---
    "Karelia": (64.0, 32.0),
    "Vyborg": (60.7, 28.7),
    "Novgorod": (58.5, 31.3),
    "Smolensk": (54.8, 32.0),
    "Bryansk": (53.2, 34.4),
    "Russia": (55.8, 37.6),    # Moscow region
    "Archangel": (64.5, 40.5),
    "Vologda": (59.2, 39.9),
    "Samara": (53.2, 50.2),
    "Rostov": (47.2, 39.7),
    "Volgograd": (48.7, 44.5),
    "Caucasus": (43.0, 44.0),
    "Tambov": (52.7, 41.4),
    "Urals": (58.0, 60.0),
    "Nenetsia": (67.5, 53.0),
    # --- Middle East ---
    "Turkey": (39.0, 35.0),
    "Syria": (35.0, 38.0),
    "Iraq": (33.0, 44.0),
    "Saudi Arabia": (24.0, 45.0),
    "Persia": (32.0, 53.0),
    "Eastern Persia": (30.0, 58.0),
    "Northwest Persia": (37.0, 46.0),
    "Trans-Jordan": (31.0, 36.5),
    "Cyprus": (35.1, 33.4),
    # --- Africa ---
    "Morocco": (32.0, -6.0),
    "Algeria": (28.0, 3.0),
    "Libya": (27.0, 17.0),
    "Tobruk": (32.0, 24.0),
    "Egypt": (26.5, 30.0),
    "Alexandria": (31.2, 29.9),
    "Anglo Egyptian Sudan": (15.5, 30.0),
    "Ethiopia": (9.0, 39.5),
    "Kenya": (0.5, 37.9),
    "French West Africa": (15.0, -4.0),
    "Nigeria": (9.0, 8.0),
    "Gold Coast": (7.5, -1.0),
    "Liberia": (6.4, -9.4),
    "Sierra Leone": (8.5, -11.8),
    "French Equatorial Africa": (5.0, 18.0),
    "French Central Africa": (15.0, 15.0),
    "Belgian Congo": (-2.0, 23.0),
    "Angola": (-12.0, 17.5),
    "Rhodesia": (-18.0, 29.0),
    "South West Africa": (-22.0, 17.0),
    "Union of South Africa": (-30.0, 24.0),
    "Mozambique": (-18.0, 35.5),
    "Tanganyika Territory": (-6.0, 35.0),
    "French Madagascar": (-19.0, 47.0),
    "Rio de Oro": (24.0, -13.0),
    # --- Asia ---
    "India": (22.0, 79.0),
    "West India": (24.0, 72.0),
    "Burma": (21.0, 96.0),
    "Ceylon": (7.5, 80.7),
    "Afghanistan": (34.0, 66.0),
    "Kazakhstan": (48.0, 67.0),
    "Turkmenistan": (39.0, 59.0),
    "Himalayas": (29.0, 88.0),
    "Novosibirsk": (55.0, 83.0),
    "Siberia": (66.0, 110.0),
    "Sakha": (66.0, 130.0),
    "Soviet Far East": (62.0, 145.0),
    "Amur": (53.0, 128.0),
    "Buryatia": (52.0, 108.0),
    "Manchuria": (47.0, 125.0),
    "Korea": (38.0, 127.5),
    "Japan": (36.0, 138.0),
    "China": None,
    "Yunnan": (25.0, 101.0),
    "Szechwan": (30.5, 103.0),
    "French Indo China": (16.0, 106.0),
    "Siam": (15.5, 101.0),
    "Malaya": (4.0, 102.0),
    "Mongolia": None,
    # --- East Indies / Pacific islands ---
    "Sumatra": (-0.5, 101.5),
    "Java": (-7.5, 110.0),
    "Borneo": (1.0, 114.0),
    "Celebes": (-2.0, 121.0),
    "Philippines": (13.0, 122.0),
    "Formosa": (23.7, 121.0),
    "New Guinea": (-6.0, 145.0),
    "Caroline Islands": (7.0, 150.0),
    "Marshall Islands": (8.0, 168.0),
    "Guam": (13.4, 144.8),
    "Wake Island": (19.3, 166.6),
    "Hawaiian Islands": (20.5, -157.5),
    "Midway": (28.2, -177.4),
    "Fiji": (-17.7, 178.0),
    "New Zealand": (-41.0, 174.0),
    "Samoa": (-13.8, -172.0),
    # --- Australia ---
    "Western Australia": (-26.0, 121.0),
    "Northern Territory": (-19.0, 133.0),
    "Queensland": (-22.0, 144.0),
    "South Australia": (-30.0, 135.0),
    "New South Wales": (-33.0, 147.0),
    "Victoria": (-37.0, 144.0),
    # --- North America ---
    "Alaska": (64.0, -153.0),
    "Yukon Territory": (63.0, -135.0),
    "British Columbia": (54.0, -125.0),
    "Alberta Saskatchewan Manitoba": (54.0, -106.0),
    "Ontario": (50.0, -86.0),
    "Quebec": (52.0, -72.0),
    "Newfoundland Labrador": (53.0, -60.0),
    "New Brunswick Nova Scotia": (45.5, -64.0),
    "Western United States": (39.0, -119.0),
    "Central United States": (39.0, -98.0),
    "Eastern United States": (37.0, -80.0),
    "Mexico": (24.0, -104.0),
    "Southeast Mexico": (18.0, -95.0),
    "Central America": (12.0, -85.0),
    "Greenland": (72.0, -40.0),
    # --- South America ---
    "Colombia": (4.0, -73.0),
    "Venezuela": (7.0, -66.0),
    "Ecuador": (-1.5, -78.0),
    "Peru": (-10.0, -76.0),
    "Brazil": (-10.0, -52.0),
    "Bolivia": (-17.0, -65.0),
    "Paraguay": (-23.0, -58.0),
    "Chile": (-35.0, -71.0),
    "Argentina": (-38.0, -64.0),
    "Uruguay": (-33.0, -56.0),
    "British Guiana": (5.0, -59.0),
    "French Guiana": (4.0, -53.0),
    "Suriname": (4.0, -56.0),
}


def load_centers():
    centers = {}
    with open(CENTERS) as f:
        for line in f:
            m = re.match(r"(.+?)\s+\((\d+),(\d+)\)", line.strip())
            if m:
                centers.setdefault(m.group(1), (int(m.group(2)), int(m.group(3))))
    return centers


def build_points():
    """Return arrays px, py, lon_real, lat_real, names for control points."""
    centers = load_centers()
    px, py, lon, lat, names = [], [], [], [], []
    for name, ll in CONTROL.items():
        if ll is None:
            continue
        if name not in centers:
            print(f"  WARN: control '{name}' not found in centers.txt — skipped")
            continue
        cx, cy = centers[name]
        px.append(cx); py.append(cy)
        lat.append(ll[0]); lon.append(ll[1])
        names.append(name)
    return (np.array(px, float), np.array(py, float),
            np.array(lon, float), np.array(lat, float), names)


def fit_lon(px, lon_real):
    """Linear lon = a + b*px in the board's CONTINUOUS frame.

    Express each real longitude as lon_real + k*360 closest to the linear-fit
    prediction (px/W*360 + LON_OFF) so the Pacific doesn't wrap.
    """
    pred = px / W * 360.0 + LON_OFF
    k = np.round((pred - lon_real) / 360.0)
    lon_cont = lon_real + k * 360.0
    A = np.vstack([np.ones_like(px), px]).T
    coef, *_ = np.linalg.lstsq(A, lon_cont, rcond=None)
    a, b = coef
    resid = (a + b * px) - lon_cont
    rms = math.sqrt(np.mean(resid ** 2))
    return a, b, lon_cont, rms


def merc_lat(py, y0, s):
    return np.degrees(2.0 * np.arctan(np.exp((y0 - py) / s)) - math.pi / 2.0)


def fit_lat_merc(py, lat_real):
    """Fit inverse-Mercator lat(py)=2*atan(exp((y0-py)/s))-pi/2 by coordinate
    descent (scipy unavailable)."""
    # Mercator y of the target latitudes.
    phi = np.radians(np.clip(lat_real, -85, 85))
    ymerc = np.log(np.tan(math.pi / 4 + phi / 2))  # increases northward
    # py increases southward, so py ~ y0 - s*ymerc. Linear least squares seed.
    A = np.vstack([np.ones_like(py), ymerc]).T
    coef, *_ = np.linalg.lstsq(A, py, rcond=None)
    y0_seed, neg_s = coef
    s_seed = -neg_s
    if s_seed <= 0:
        s_seed = abs(s_seed) or 600.0
    y0, s = float(y0_seed), float(s_seed)

    def rms(y0, s):
        return math.sqrt(np.mean((merc_lat(py, y0, s) - lat_real) ** 2))

    best = rms(y0, s)
    # Coordinate descent with shrinking steps.
    dy0, ds = 200.0, 200.0
    for _ in range(4000):
        improved = False
        for cand in ((y0 + dy0, s), (y0 - dy0, s), (y0, s + ds), (y0, s - ds)):
            cy0, cs = cand
            if cs <= 1:
                continue
            r = rms(cy0, cs)
            if r < best - 1e-9:
                y0, s, best = cy0, cs, r
                improved = True
                break
        if not improved:
            dy0 *= 0.5
            ds *= 0.5
            if dy0 < 1e-3 and ds < 1e-3:
                break
    return y0, s, best


def fit_lat_linear(py, lat_real):
    A = np.vstack([np.ones_like(py), py]).T
    coef, *_ = np.linalg.lstsq(A, lat_real, rcond=None)
    a, b = coef
    resid = (a + b * py) - lat_real
    return a, b, math.sqrt(np.mean(resid ** 2))


def main():
    # Preserve original on first run; always sample from the preserved copy.
    if not os.path.exists(EARTH_SRC):
        shutil.copyfile(EARTH_OUT, EARTH_SRC)
        print(f"Preserved original -> {EARTH_SRC}")
    src = np.asarray(Image.open(EARTH_SRC).convert("RGB"), dtype=np.float32)
    SH, SW = src.shape[:2]

    px, py, lon_real, lat_real, names = build_points()
    print(f"Control points: {len(names)}")

    # --- longitude fit ---
    lon_a, lon_b, lon_cont, lon_rms = fit_lon(px, lon_real)
    print(f"Longitude fit: lon = {lon_a:.3f} + {lon_b:.5f}*px   RMS={lon_rms:.3f} deg")

    # --- latitude fit: mercator vs linear ---
    y0, s, merc_rms = fit_lat_merc(py, lat_real)
    lin_a, lin_b, lin_rms = fit_lat_linear(py, lat_real)
    if merc_rms <= lin_rms:
        lat_model = "mercator"
        lat_pred_pts = merc_lat(py, y0, s)
        print(f"Latitude fit: MERCATOR y0={y0:.2f} s={s:.2f}  RMS={merc_rms:.3f}  "
              f"(linear fallback RMS={lin_rms:.3f})")
    else:
        lat_model = "linear"
        lat_pred_pts = lin_a + lin_b * py
        print(f"Latitude fit: LINEAR a={lin_a:.3f} b={lin_b:.5f}  RMS={lin_rms:.3f}  "
              f"(mercator RMS={merc_rms:.3f})")

    # --- residuals at control points (global fit) ---
    lon_pred_pts = lon_a + lon_b * px
    dlon = lon_cont - lon_pred_pts        # add to predicted lon to hit real
    dlat = lat_real - lat_pred_pts        # add to predicted lat to hit real
    global_rms = math.sqrt(np.mean(dlon ** 2 + dlat ** 2))
    print(f"Global fit combined RMS (lon,lat): {global_rms:.3f} deg")

    # Worst control points by combined residual.
    comb = np.sqrt(dlon ** 2 + dlat ** 2)
    worst = np.argsort(comb)[::-1][:10]
    print("\n10 worst control points (combined residual deg):")
    for i in worst:
        print(f"  {names[i]:<28} dlon={dlon[i]:+6.2f} dlat={dlat[i]:+6.2f} "
              f"|r|={comb[i]:5.2f}  px=({int(px[i])},{int(py[i])})")

    # --- residual RBF field weights setup ---
    cap = RESID_CAP
    dlon_c = np.clip(dlon, -cap, cap)
    dlat_c = np.clip(dlat, -cap, cap)

    def rbf_eval(qx, qy):
        """Evaluate Gaussian-weighted residual field at query board pixels.
        qx, qy are flat arrays; returns (rlon, rlat) flat arrays."""
        N = qx.shape[0]
        rlon = np.empty(N, np.float32)
        rlat = np.empty(N, np.float32)
        cx = px.astype(np.float32)
        cy = py.astype(np.float32)
        inv2s2 = 1.0 / (2.0 * RBF_SIGMA * RBF_SIGMA)
        CHUNK = 200000
        for start in range(0, N, CHUNK):
            sl = slice(start, start + CHUNK)
            dx = qx[sl][:, None] - cx[None, :]
            dy = qy[sl][:, None] - cy[None, :]
            w = np.exp(-(dx * dx + dy * dy) * inv2s2)
            wsum = w.sum(axis=1) + RBF_REG
            rlon[sl] = (w @ dlon_c) / wsum
            rlat[sl] = (w @ dlat_c) / wsum
        return rlon, rlat

    # RMS after RBF (leave-in evaluation at control points).
    rl, ra = rbf_eval(px.astype(np.float32), py.astype(np.float32))
    after_lon = dlon - rl
    after_lat = dlat - ra
    after_rms = math.sqrt(np.mean(after_lon ** 2 + after_lat ** 2))
    print(f"\nCombined RMS  before RBF={global_rms:.3f}  after RBF={after_rms:.3f} deg")

    def board_to_real(px_q, py_q):
        """Full projection P:(px,py)->(lon,lat) incl. RBF residual."""
        lon = lon_a + lon_b * px_q
        if lat_model == "mercator":
            lat = merc_lat(py_q, y0, s)
        else:
            lat = lin_a + lin_b * py_q
        rl, ra = rbf_eval(px_q.ravel(), py_q.ravel())
        lon = lon.ravel() + rl
        lat = lat.ravel() + ra
        return lon, lat

    # --- build output grid ---
    u = np.arange(OUT_W)
    v = np.arange(OUT_H)
    UU, VV = np.meshgrid(u, v)
    lon_lin = UU / OUT_W * 360.0 - 180.0       # globe UV: u=0 -> lon -180 (linear frame)
    lat_lin = 90.0 - VV / OUT_H * 180.0

    # Invert linear fit -> board pixel.
    # lon_lin' = lon_lin + k*360 into [LON_OFF, LON_OFF+360)
    lon_shift = lon_lin - LON_OFF
    lon_shift = np.mod(lon_shift, 360.0)
    lon_board = lon_shift + LON_OFF
    px_q = lon_shift / 360.0 * W                 # since lon_board = px/W*360 + LON_OFF
    py_q = (lat_lin - LAT_A) / LAT_B

    # --- warped sampling: P(px,py) -> real lon/lat -> source pixels ---
    in_band = (py_q >= 0) & (py_q <= H)
    # Clamp py for projection then handle edge blend separately.
    py_clamped = np.clip(py_q, 0, H)
    real_lon, real_lat = board_to_real(px_q.astype(np.float32), py_clamped.astype(np.float32))
    real_lon = real_lon.reshape(OUT_H, OUT_W)
    real_lat = real_lat.reshape(OUT_H, OUT_W)

    def sample(rlon, rlat):
        """Bilinear sample source equirectangular image at real lon/lat (deg).
        Source: u=0 -> lon -180, v=0 -> lat +90. Lon wraps."""
        su = (rlon + 180.0) / 360.0 * SW
        su = np.mod(su, SW)
        sv = (90.0 - rlat) / 180.0 * SH
        sv = np.clip(sv, 0, SH - 1.0001)
        u0 = np.floor(su).astype(int)
        v0 = np.floor(sv).astype(int)
        u1 = (u0 + 1) % SW
        v1 = np.clip(v0 + 1, 0, SH - 1)
        fu = (su - u0)[..., None]
        fv = (sv - v0)[..., None]
        c00 = src[v0, u0]; c01 = src[v0, u1]
        c10 = src[v1, u0]; c11 = src[v1, u1]
        top = c00 * (1 - fu) + c01 * fu
        bot = c10 * (1 - fu) + c11 * fu
        return top * (1 - fv) + bot * fv

    warped = sample(real_lon, real_lat)

    # Identity sampling (linear frame directly) for poles / out-of-board.
    identity = sample(lon_lin, lat_lin)

    # Edge blend: where py_q is outside [0,H], or within EDGE_BLEND_DEG of the
    # board's top/bottom lat edge, blend warped -> identity.
    lat_top = LAT_A                        # py=0
    lat_bot = LAT_A + LAT_B * H            # py=H
    # fraction of "warped" (1 inside, 0 outside)
    wfrac = np.ones((OUT_H, OUT_W), np.float32)
    # top edge (high latitude)
    wfrac = np.where(lat_lin > lat_top,
                     np.clip((lat_top + EDGE_BLEND_DEG - lat_lin) / EDGE_BLEND_DEG, 0, 1),
                     wfrac)
    # bottom edge (low latitude)
    wfrac = np.where(lat_lin < lat_bot,
                     np.clip((lat_lin - (lat_bot - EDGE_BLEND_DEG)) / EDGE_BLEND_DEG, 0, 1),
                     wfrac)
    wfrac = wfrac[..., None]
    warped_full = warped * wfrac + identity * (1 - wfrac)

    # --- compositing stage: cut land/sea to the board's exact coastlines ---
    out = composite(warped_full)

    Image.fromarray(out, "RGB").save(EARTH_OUT, quality=85)
    print(f"\nWrote {EARTH_OUT} ({OUT_W}x{OUT_H}, q85)")

    # ---------------------------------------------------------------------
    # Verification overlays: draw province rings (linear frame) in red.
    # ---------------------------------------------------------------------
    rings = parse_borders()
    after_img = Image.fromarray(out, "RGB")
    before_img = Image.fromarray(
        np.clip(sample_to_identity(src, SW, SH), 0, 255).astype(np.uint8), "RGB")
    draw_rings(after_img, rings)
    draw_rings(before_img, rings)
    after_img.save("/tmp/warp_check.png")
    before_img.save("/tmp/warp_check_before.png")
    print("Wrote /tmp/warp_check.png and /tmp/warp_check_before.png")

    # Inspection crops (800px wide regions of interest), of the AFTER overlay.
    save_crop(after_img, "Europe", 1000, 200, 1500, 700)
    save_crop(after_img, "JapanPacific", 1350, 200, 2048, 750)
    save_crop(after_img, "NorthAmerica", 0, 150, 700, 650)
    print("Wrote /tmp crops: europe/japanpacific/northamerica")

    # --- compositing-stage verification: rings on the COMPOSITED texture ---
    comp_img = Image.fromarray(out, "RGB")
    draw_rings(comp_img, rings)
    comp_img.save("/tmp/warp_check2.png")
    print("Wrote /tmp/warp_check2.png (composited + rings)")
    # u=(lon+180)/360*2048: lon -10 -> ~967, lon 50 -> ~1308 (Europe/Caspian)
    save_named_crop(comp_img, "europe", 960, 250, 1340, 620)
    # Pacific / Japan / SE Asia: lon 95..175 -> u ~1564..2018
    save_named_crop(comp_img, "pacific", 1560, 250, 2040, 760)
    # Americas: lon -125..-55 -> u ~312..711
    save_named_crop(comp_img, "americas", 130, 150, 720, 880)
    print("Wrote /tmp fit crops: europe/pacific/americas")


def sample_to_identity(src, SW, SH):
    """Resample the ORIGINAL source to OUT_W x OUT_H with identity lon/lat map
    (so the 'before' image is the unwarped earth at output resolution)."""
    u = np.arange(OUT_W)
    v = np.arange(OUT_H)
    UU, VV = np.meshgrid(u, v)
    su = UU / OUT_W * SW
    sv = VV / OUT_H * SH
    u0 = np.floor(su).astype(int) % SW
    v0 = np.clip(np.floor(sv).astype(int), 0, SH - 1)
    return src[v0, u0]


def parse_terrain():
    """territory id -> terrain ('land' | 'sea') from territories.ts."""
    txt = open(TERRITORIES_TS).read()
    terr = {}
    for m in re.finditer(r'id:\s*"([a-z0-9_]+)".*?terrain:\s*"([a-z]+)"', txt):
        terr[m.group(1)] = m.group(2)
    return terr


def parse_borders_by_id():
    """Parse borders.ts -> {id: [ring,...]} where ring is a list of (lon,lat)."""
    txt = open(BORDERS_TS).read()
    start = txt.index("{", txt.index("BORDERS"))
    body = txt[start:]
    out = {}
    for m in re.finditer(r'"([a-z0-9_]+)":\s*(\[\[.*?\]\]),?\n', body):
        tid = m.group(1)
        try:
            data = json.loads(m.group(2))
        except Exception:
            continue
        rings = []
        for ring in data:
            pts = [(p[0], p[1]) for p in ring if len(p) == 2]
            if len(pts) >= 3:
                rings.append(pts)
        if rings:
            out[tid] = rings
    return out


def build_land_mask():
    """Rasterize an antialiased land mask (float32 in [0,1]) at OUT_W x OUT_H.

    Fill every LAND territory's rings using the renderer's exact UV mapping
    (x=(lon+180)/360*W, y=(90-lat)/180*H). Supersample by SS then box-downsample.
    Lon wrap: each ring is drawn at lon and lon+-360 so polygons that straddle
    the +-180 seam (Pacific rings go up to ~+250 deg) fill on both sides.
    """
    terr = parse_terrain()
    borders = parse_borders_by_id()
    MW, MH = OUT_W * SS, OUT_H * SS
    mask = Image.new("L", (MW, MH), 0)
    draw = ImageDraw.Draw(mask)
    n_land = 0
    for tid, rings in borders.items():
        if terr.get(tid) != "land":
            continue
        n_land += 1
        for ring in rings:
            for shift in (-360.0, 0.0, 360.0):
                poly = []
                for lon, lat in ring:
                    x = (lon + shift + 180.0) / 360.0 * MW
                    y = (90.0 - lat) / 180.0 * MH
                    poly.append((x, y))
                draw.polygon(poly, fill=255)
    arr = np.asarray(mask, np.float32) / 255.0
    # Box-downsample SSxSS -> antialiased edges.
    arr = arr.reshape(OUT_H, SS, OUT_W, SS).mean(axis=(1, 3))
    print(f"Land mask: filled {n_land} land territories  "
          f"(land fraction {arr.mean():.3f})")
    return arr


def composite(warped):
    """Re-cut `warped` (OUT_H x OUT_W x3 float32) so the land/sea boundary is the
    board's land mask. Returns uint8 RGB."""
    mask = build_land_mask()                      # (H,W) float in [0,1]
    r, g, b = warped[..., 0], warped[..., 1], warped[..., 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    # "Water-looking" warped pixels: bluish or dark.
    is_water = ((b > r) & (b > g)) | (lum < 55.0)

    # --- land-color fill: heavily blurred field from non-water warped pixels ---
    land_px = (~is_water).astype(np.float32)[..., None]
    num = warped * land_px
    den = land_px
    # Big gaussian-ish blur on numerator and denominator, then divide -> at each
    # pixel, the average colour of nearby genuine-land pixels. Where almost no
    # land lies within reach (den tiny), fall back to the global mean land color
    # so big interior gaps (e.g. a black warp patch) never collapse to black.
    num_b = _big_blur(num)
    den_b = _big_blur(den)
    glob_land = num.reshape(-1, 3).sum(0) / max(den.sum(), 1.0)
    t = np.clip(den_b / 0.04, 0.0, 1.0)          # confidence in the local blur
    land_color = (num_b / np.maximum(den_b, 1e-4)) * t \
        + glob_land[None, None, :] * (1.0 - t)

    # --- ocean fill: deep blue blended with local satellite water tone ---
    water_px = is_water.astype(np.float32)[..., None]
    wnum = _big_blur(warped * water_px)
    wden = _big_blur(water_px)
    glob_water = (warped * water_px).reshape(-1, 3).sum(0) / max(water_px.sum(), 1.0)
    tw = np.clip(wden / 0.04, 0.0, 1.0)
    local_water = (wnum / np.maximum(wden, 1e-4)) * tw \
        + glob_water[None, None, :] * (1.0 - tw)
    ocean = 0.62 * DEEP_OCEAN[None, None, :] + 0.38 * local_water

    # Inside land: warped where it's real land, else blurred land color.
    inside = np.where(is_water[..., None], land_color, warped)
    # Outside land: warped where it's real water, else deep ocean.
    outside = np.where(is_water[..., None], warped, ocean)

    m = mask[..., None]
    out = inside * m + outside * (1.0 - m)
    return np.clip(out, 0, 255).astype(np.uint8)


def _big_blur(img, passes=4, radius=28):
    """Cheap large-radius blur: repeated box blurs via cumulative sums.

    img: (H,W,C) float32. Returns same shape. With passes=4, radius=28 the
    effective spread is ~100px, enough to bridge large interior warp gaps.
    Horizontal wraps (cyclic texture); vertical is edge-extended."""
    out = img
    for _ in range(passes):
        out = _box_blur(out, radius)
    return out


def _box_blur(img, r):
    H_, W_, C = img.shape
    # Horizontal (with lon wrap, since the texture is cyclic in x).
    pad = np.concatenate([img[:, -r:], img, img[:, :r]], axis=1)
    cs = np.cumsum(pad, axis=1)
    cs = np.concatenate([np.zeros((H_, 1, C), img.dtype), cs], axis=1)
    horiz = (cs[:, 2 * r + 1:] - cs[:, :-(2 * r + 1)]) / (2 * r + 1)
    horiz = horiz[:, :W_]
    # Vertical (edge-extended).
    padv = np.concatenate(
        [np.repeat(horiz[:1], r, axis=0), horiz, np.repeat(horiz[-1:], r, axis=0)],
        axis=0)
    cs = np.cumsum(padv, axis=0)
    cs = np.concatenate([np.zeros((1, W_, C), img.dtype), cs], axis=0)
    vert = (cs[2 * r + 1:] - cs[:-(2 * r + 1)]) / (2 * r + 1)
    return vert[:H_]


def parse_borders():
    """Parse borders.ts -> list of rings (each a list of (lon,lat))."""
    txt = open(BORDERS_TS).read()
    start = txt.index("{", txt.index("BORDERS"))
    body = txt[start:]
    rings = []
    # Each value is a JSON-ish array of rings of [lon,lat] pairs.
    for m in re.finditer(r'"[^"]+":\s*(\[\[.*?\]\]),?\n', body):
        try:
            data = json.loads(m.group(1))
        except Exception:
            continue
        for ring in data:
            pts = [(p[0], p[1]) for p in ring if len(p) == 2]
            if len(pts) >= 2:
                rings.append(pts)
    return rings


def draw_rings(img, rings, color=(255, 30, 30)):
    arr = np.asarray(img).copy()
    H_, W_ = arr.shape[:2]
    for ring in rings:
        pts = ring + [ring[0]]
        for (lon0, lat0), (lon1, lat1) in zip(pts, pts[1:]):
            x0 = (lon0 + 180.0) / 360.0 * W_
            y0 = (90.0 - lat0) / 180.0 * H_
            x1 = (lon1 + 180.0) / 360.0 * W_
            y1 = (90.0 - lat1) / 180.0 * H_
            # skip segments that wrap across the seam
            if abs(x1 - x0) > W_ / 2:
                continue
            n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
            xs = np.linspace(x0, x1, n)
            ys = np.linspace(y0, y1, n)
            xi = np.clip(xs.astype(int), 0, W_ - 1)
            yi = np.clip(ys.astype(int), 0, H_ - 1)
            arr[yi, xi] = color
            arr[np.clip(yi + 1, 0, H_ - 1), xi] = color
    img.paste(Image.fromarray(arr))


def save_crop(img, label, x0, y0, x1, y1, target_w=800):
    crop = img.crop((x0, y0, x1, y1))
    w, h = crop.size
    scale = target_w / w
    crop = crop.resize((target_w, max(1, int(h * scale))))
    crop.save(f"/tmp/warp_{label.lower()}.png")


def save_named_crop(img, label, x0, y0, x1, y1, target_w=800):
    crop = img.crop((x0, y0, x1, y1))
    w, h = crop.size
    scale = target_w / w
    crop = crop.resize((target_w, max(1, int(h * scale))))
    crop.save(f"/tmp/fit_{label}.png")


if __name__ == "__main__":
    main()
