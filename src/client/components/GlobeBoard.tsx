import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useLoader, useFrame, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Line, Html, Stars } from "@react-three/drei";
import * as THREE from "three";
import {
  TERRITORIES,
  TERRITORY_INDEX,
  BORDERS,
  POWERS,
  UNITS,
  isSea,
  neighbours,
  areEnemies,
  KAMIKAZE_ISLANDS,
  type GameState,
  type PowerId,
  type UnitTypeId,
  type UnitStack,
} from "@engine/index";

const STRUCTURES = new Set<UnitTypeId>(["air_base", "naval_base", "major_ic", "minor_ic"]);
const WARSHIPS = new Set<UnitTypeId>(["destroyer", "cruiser", "battleship", "aircraft_carrier", "submarine"]);

// ============================================================================
// 3D globe renderer (three.js / react-three-fiber).
//
// The world is a sphere whose continents ARE the Axis & Allies provinces (real
// board outlines wrapped onto the sphere) over an opaque daytime satellite layer
// (warped by tools/triplea/warp_earth.py so its coastlines match the board).
//
// Detail is ZOOM-AWARE so the board reads cleanly at every scale:
//   far  (cam > ~2.5) — one clean force dot per occupied territory, no models,
//                       no count chips, only capital labels.
//   mid  (~1.7–2.5)  — 3D models + count chips for real stacks, city labels.
//   near (cam < ~1.7) — full detail, every label.
// The transition is faded (opacity) rather than popped, and the bucket is only
// recomputed when the camera crosses a threshold (no per-frame React churn).
// ============================================================================

const R = 1;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const Y = new THREE.Vector3(0, 1, 0);
// Imported as a hashed Vite asset so deploys are never hidden by a stale
// browser/CDN cache of the old map imagery.
import EARTH_SRC from "../assets/earth_day.jpg";

// --- Zoom state -------------------------------------------------------------
// A single shared object the whole scene reads from. `dist` is updated every
// frame (cheap, no React), `bucket` flips only at threshold crossings.
type ZoomBucket = "far" | "mid" | "near";
const NEAR_MAX = 1.72; // camera distance below this = near
const FAR_MIN = 2.5; //  above this = far
interface ZoomRef {
  dist: number;
  bucket: ZoomBucket;
  // 0 at near edge → 1 at far edge of the mid band; lets markers/models fade.
  detail: number; // 1 = full detail (near), 0 = no models (far)
}

function ll2v(lat: number, lon: number, r = R): THREE.Vector3 {
  const phi = (90 - lat) * DEG;
  const theta = (lon + 180) * DEG;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
}

/** Sphere with UVs matching ll2v, so the satellite texture lines up. */
function geoSphere(radius: number, seg = 96): THREE.SphereGeometry {
  const g = new THREE.SphereGeometry(radius, seg, seg);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.sqrt(x * x + y * y + z * z) || 1;
    const lat = 90 - Math.acos(y / r) * RAD;
    const lon = Math.atan2(z, -x) * RAD - 180;
    uv.setXY(i, (lon + 180) / 360, (lat + 90) / 180);
  }
  uv.needsUpdate = true;
  return g;
}

function controllerColor(state: GameState, id: string): string {
  if (isSea(id)) return "#1b5fa0";
  const c = state.territories[id]?.controller;
  return c ? POWERS[c as PowerId].color : "#6b7689";
}

// --- 3D unit models --------------------------------------------------------
// Small parametric models (no external assets, so it works fully offline).
// Built around the origin standing on +Y; the parent group tilts them so they
// stand upright on the globe surface. Materials are muted (roughness ~0.7, no
// garish metalness) so they read as solid silhouettes rather than shiny sticks.

const STEEL = "#aab2c0";
const DARK = "#23272f";
const GUN = "#191c22";

// One shared material config keeps every model matte + consistent.
const matte = { roughness: 0.72, metalness: 0.0 } as const;

function UnitModel({ type, color }: { type: UnitTypeId; color: string }) {
  switch (type) {
    case "infantry":
      return (
        <group>
          <mesh position={[0, 0.009, 0]}><capsuleGeometry args={[0.0045, 0.011, 4, 8]} /><meshStandardMaterial color={color} {...matte} /></mesh>
          <mesh position={[0, 0.02, 0]}><sphereGeometry args={[0.005, 10, 10]} /><meshStandardMaterial color={color} {...matte} /></mesh>
        </group>
      );
    case "mech_infantry":
      return (
        <group>
          <mesh position={[0, 0.006, 0]}><boxGeometry args={[0.022, 0.009, 0.012]} /><meshStandardMaterial color={color} {...matte} /></mesh>
          <mesh position={[0, 0.002, 0.0075]}><boxGeometry args={[0.024, 0.005, 0.003]} /><meshStandardMaterial color={DARK} {...matte} /></mesh>
          <mesh position={[0, 0.002, -0.0075]}><boxGeometry args={[0.024, 0.005, 0.003]} /><meshStandardMaterial color={DARK} {...matte} /></mesh>
          <mesh position={[0.004, 0.016, 0]}><capsuleGeometry args={[0.004, 0.008, 3, 8]} /><meshStandardMaterial color={color} {...matte} /></mesh>
        </group>
      );
    case "artillery":
      return (
        <group>
          <mesh position={[0, 0.005, 0]}><boxGeometry args={[0.013, 0.008, 0.011]} /><meshStandardMaterial color={color} {...matte} /></mesh>
          <mesh position={[0, 0.001, 0]}><cylinderGeometry args={[0.0065, 0.0065, 0.004, 12]} /><meshStandardMaterial color={DARK} {...matte} /></mesh>
          <mesh position={[0.013, 0.013, 0]} rotation={[0, 0, -0.6]}><cylinderGeometry args={[0.0017, 0.0017, 0.024, 8]} /><meshStandardMaterial color={GUN} {...matte} /></mesh>
        </group>
      );
    case "tank":
      return (
        <group>
          {/* hull + track skirts */}
          <mesh position={[0, 0.0065, 0]}><boxGeometry args={[0.024, 0.008, 0.014]} /><meshStandardMaterial color={color} {...matte} /></mesh>
          <mesh position={[0, 0.003, 0.0085]}><boxGeometry args={[0.026, 0.007, 0.004]} /><meshStandardMaterial color={DARK} {...matte} /></mesh>
          <mesh position={[0, 0.003, -0.0085]}><boxGeometry args={[0.026, 0.007, 0.004]} /><meshStandardMaterial color={DARK} {...matte} /></mesh>
          {/* turret + barrel */}
          <mesh position={[-0.002, 0.014, 0]}><boxGeometry args={[0.013, 0.007, 0.011]} /><meshStandardMaterial color={color} {...matte} /></mesh>
          <mesh position={[0.014, 0.015, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.0015, 0.0015, 0.02, 8]} /><meshStandardMaterial color={GUN} {...matte} /></mesh>
        </group>
      );
    case "aa_gun":
      return (
        <group>
          <mesh position={[0, 0.005, 0]}><boxGeometry args={[0.013, 0.007, 0.013]} /><meshStandardMaterial color={color} {...matte} /></mesh>
          <mesh position={[0, 0.016, 0]} rotation={[0.5, 0, 0]}><cylinderGeometry args={[0.0013, 0.0013, 0.02, 8]} /><meshStandardMaterial color={GUN} {...matte} /></mesh>
        </group>
      );
    case "fighter":
    case "tactical_bomber":
    case "strategic_bomber": {
      const big = type === "strategic_bomber" ? 1.5 : type === "tactical_bomber" ? 1.2 : 1;
      // fuselage points along +Z; swept wings sit at the shoulders.
      return (
        <group position={[0, 0.032, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh><coneGeometry args={[0.0055 * big, 0.03 * big, 10]} /><meshStandardMaterial color={color} {...matte} /></mesh>
          {/* swept main wing (parallelogram via skewed box) */}
          <mesh position={[0, 0.001, 0]} rotation={[0, 0, 0.18]}><boxGeometry args={[0.032 * big, 0.0012, 0.008 * big]} /><meshStandardMaterial color={color} {...matte} /></mesh>
          {/* tailplane */}
          <mesh position={[0, -0.012 * big, 0]}><boxGeometry args={[0.014 * big, 0.0011, 0.005 * big]} /><meshStandardMaterial color={color} {...matte} /></mesh>
          {/* vertical fin */}
          <mesh position={[0, -0.012 * big, 0.003]} rotation={[Math.PI / 2, 0, 0]}><boxGeometry args={[0.0011, 0.006 * big, 0.005 * big]} /><meshStandardMaterial color={DARK} {...matte} /></mesh>
        </group>
      );
    }
    case "submarine":
      return (
        <group position={[0, 0.003, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh><capsuleGeometry args={[0.0045, 0.026, 6, 10]} /><meshStandardMaterial color={DARK} {...matte} /></mesh>
          <mesh position={[0, 0.0015, 0.006]}><boxGeometry args={[0.004, 0.007, 0.004]} /><meshStandardMaterial color={GUN} {...matte} /></mesh>
        </group>
      );
    case "destroyer":
    case "cruiser":
    case "battleship":
    case "aircraft_carrier":
    case "transport": {
      const len = type === "battleship" || type === "aircraft_carrier" ? 0.042 : type === "cruiser" ? 0.034 : 0.028;
      const wide = type === "aircraft_carrier" ? 0.017 : 0.011;
      // Layered hull: a tapered bow box + main hull gives a ship silhouette.
      return (
        <group position={[0, 0.004, 0]}>
          <mesh position={[-len * 0.05, 0, 0]}><boxGeometry args={[len * 0.85, 0.006, wide]} /><meshStandardMaterial color={color} {...matte} /></mesh>
          <mesh position={[len * 0.45, 0, 0]} rotation={[0, 0, 0]}><coneGeometry args={[wide * 0.5, len * 0.22, 4]} /><meshStandardMaterial color={color} {...matte} /></mesh>
          {type === "aircraft_carrier" && (
            <mesh position={[0, 0.005, 0]}><boxGeometry args={[len * 0.95, 0.0012, wide * 0.88]} /><meshStandardMaterial color={STEEL} {...matte} /></mesh>
          )}
          {(type === "cruiser" || type === "battleship") && (
            <mesh position={[0, 0.0095, 0]}><boxGeometry args={[len * 0.32, 0.008, wide * 0.6]} /><meshStandardMaterial color={STEEL} {...matte} /></mesh>
          )}
          {type === "battleship" && (
            <>
              <mesh position={[len * 0.26, 0.011, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.0013, 0.0013, 0.013, 6]} /><meshStandardMaterial color={GUN} {...matte} /></mesh>
              <mesh position={[-len * 0.22, 0.011, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.0013, 0.0013, 0.013, 6]} /><meshStandardMaterial color={GUN} {...matte} /></mesh>
            </>
          )}
          {type === "transport" && (
            <mesh position={[0, 0.0085, 0]}><boxGeometry args={[len * 0.5, 0.007, wide * 0.82]} /><meshStandardMaterial color="#7a6a44" {...matte} /></mesh>
          )}
          {type === "destroyer" && (
            <mesh position={[0, 0.0085, 0]}><boxGeometry args={[len * 0.22, 0.007, wide * 0.5]} /><meshStandardMaterial color={STEEL} {...matte} /></mesh>
          )}
        </group>
      );
    }
    case "major_ic":
    case "minor_ic": {
      const big = type === "major_ic" ? 1.3 : 1;
      return (
        <group>
          <mesh position={[0, 0.008 * big, 0]}><boxGeometry args={[0.02 * big, 0.016 * big, 0.016 * big]} /><meshStandardMaterial color="#8a8f99" roughness={0.85} metalness={0} /></mesh>
          <mesh position={[0, 0.017 * big, 0]}><boxGeometry args={[0.021 * big, 0.003 * big, 0.017 * big]} /><meshStandardMaterial color="#5a5f68" {...matte} /></mesh>
          <mesh position={[0.006 * big, 0.022 * big, 0]}><cylinderGeometry args={[0.0022, 0.0022, 0.012 * big, 8]} /><meshStandardMaterial color="#4a4f58" {...matte} /></mesh>
        </group>
      );
    }
    case "air_base":
      return (
        <group>
          <mesh position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.016, 20]} /><meshStandardMaterial color="#33383f" {...matte} /></mesh>
          <mesh position={[0.008, 0.008, 0]}><boxGeometry args={[0.004, 0.014, 0.004]} /><meshStandardMaterial color={STEEL} {...matte} /></mesh>
        </group>
      );
    case "naval_base":
      return (
        <group>
          <mesh position={[0, 0.004, 0]}><boxGeometry args={[0.018, 0.006, 0.01]} /><meshStandardMaterial color="#6a6f78" {...matte} /></mesh>
        </group>
      );
    default:
      return (
        <mesh position={[0, 0.01, 0]}><coneGeometry args={[0.008, 0.02, 6]} /><meshStandardMaterial color={color} {...matte} /></mesh>
      );
  }
}

// --- A&A chip stacks -------------------------------------------------------
// Classic tabletop convention: a single plastic model identifies the TYPE, and
// it stands on a stack of value chips that encode the quantity. We render the
// model as count=1, then greedily decompose the REMAINING (count - 1) into
// red(5) / yellow(3) / grey(1) discs, biggest first — so the chip pile under a
// model reads as "how many of this type" at a glance:
//   count 1  → no chips         count 2  → grey
//   count 4  → yellow           count 7  → red + grey
//   count 12 → red + red + grey
const CHIP_VALUES = [
  { v: 5, color: "#d2403a" }, // red
  { v: 3, color: "#e7c14a" }, // yellow
  { v: 1, color: "#9aa3b0" }, // grey
] as const;

/** Greedy decomposition of (count-1) into red/yellow/grey chip values. */
function chipDecomp(count: number): number[] {
  let rem = Math.max(0, count - 1);
  const chips: number[] = [];
  for (const { v } of CHIP_VALUES) {
    while (rem >= v) { chips.push(v); rem -= v; }
  }
  return chips; // ordered largest→smallest (bottom→top of pile)
}

// Shared, reused geometry + the three chip materials. One cylinder geometry is
// instanced across all 333 territories; only three materials ever exist, so the
// chip layer stays cheap regardless of how dense the board gets.
const CHIP_R = 0.0095; // slightly wider than a model footprint
const CHIP_H = 0.0028; // base chip thickness (scaled down when piles are tall)
const chipGeo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 16);
const chipRimGeo = new THREE.CylinderGeometry(CHIP_R * 1.04, CHIP_R * 1.04, CHIP_H * 0.34, 16);
const chipMats: Record<number, THREE.MeshStandardMaterial> = {
  5: new THREE.MeshStandardMaterial({ color: "#d2403a", roughness: 0.6, metalness: 0 }),
  3: new THREE.MeshStandardMaterial({ color: "#e7c14a", roughness: 0.6, metalness: 0 }),
  1: new THREE.MeshStandardMaterial({ color: "#9aa3b0", roughness: 0.6, metalness: 0 }),
};
// A darker rim disc sits at each chip's lower edge so individual chips in a
// stack stay visually separable even when same-coloured chips touch.
const chipRimMat = new THREE.MeshStandardMaterial({ color: "#1a1d24", roughness: 0.8, metalness: 0 });

/**
 * A model standing on its plastic-chip pile. Returns the pile height so the
 * caller can sit the model on top. Caps the visual pile at MAX_CHIPS and
 * thins the discs when there are many, so tall stacks never tower out of the
 * province footprint.
 */
const MAX_CHIPS = 5;
function ChipPile({ count }: { count: number }) {
  const chips = chipDecomp(count);
  if (chips.length === 0) return null;
  // Compress very tall piles: keep the most valuable chips, and thin them so
  // the whole pile never exceeds ~MAX_CHIPS base-thickness.
  const overflow = chips.length > MAX_CHIPS;
  const shown = overflow ? chips.slice(0, MAX_CHIPS) : chips;
  const thin = overflow ? MAX_CHIPS / chips.length : 1;
  const h = CHIP_H * thin;
  let y = 0;
  const out: React.ReactElement[] = [];
  for (let i = 0; i < shown.length; i++) {
    const cy = y + h / 2;
    out.push(
      <group key={i} position={[0, cy, 0]}>
        <mesh geometry={chipGeo} material={chipMats[shown[i]]} scale={[1, thin, 1]} />
        <mesh geometry={chipRimGeo} material={chipRimMat} position={[0, -h / 2, 0]} scale={[1, thin, 1]} />
      </group>,
    );
    y += h;
  }
  return <>{out}</>;
}

/** Resolved height of the chip pile for a given count (to seat the model). */
function pileHeight(count: number): number {
  const chips = chipDecomp(count);
  if (chips.length === 0) return 0;
  const thin = chips.length > MAX_CHIPS ? MAX_CHIPS / chips.length : 1;
  return CHIP_H * thin * Math.min(chips.length, MAX_CHIPS);
}

interface Props {
  state: GameState;
  selected: string | null;
  targets: Set<string>;
  range?: Set<string>;
  battles: Set<string>;
  onPick: (id: string) => void;
  onHoverTerr?: (id: string | null) => void;
  lastMove?: { from: string; to: string; type: UnitTypeId; owner: string; nonce: number } | null;
}

interface Cell {
  id: string;
  sea: boolean;
  fill: THREE.BufferGeometry;
  rings: [number, number, number][][];
  pos: THREE.Vector3;
  surf: THREE.Vector3; // surface point (lower) for travelling pieces
  display: string;
  victoryCity: boolean;
}

function buildFill(rings: [number, number][][], radius: number): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const ring of rings) {
    let pts = ring;
    if (pts.length > 2) {
      const [fx, fy] = pts[0];
      const [lx, ly] = pts[pts.length - 1];
      if (fx === lx && fy === ly) pts = pts.slice(0, -1);
    }
    if (pts.length < 3) continue;
    const contour = pts.map(([lon, lat]) => new THREE.Vector2(lon, lat));
    let tris: number[][];
    try {
      tris = THREE.ShapeUtils.triangulateShape(contour, []);
    } catch {
      continue;
    }
    for (const tri of tris) {
      for (const idx of tri) {
        const v = ll2v(pts[idx][1], pts[idx][0], radius);
        positions.push(v.x, v.y, v.z);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

function useCells(): { cells: Cell[]; byId: Map<string, Cell> } {
  return useMemo(() => {
    const cells: Cell[] = [];
    const byId = new Map<string, Cell>();
    for (const t of TERRITORIES) {
      const rings = BORDERS[t.id] ?? [];
      if (!rings.length) continue;
      const sea = isSea(t.id);
      const fill = buildFill(rings, sea ? 1.001 : 1.0035);
      const sphereRings = rings.map((ring) =>
        ring.map(([lon, lat]) => {
          const v = ll2v(lat, lon, sea ? 1.0015 : 1.004);
          return [v.x, v.y, v.z] as [number, number, number];
        }),
      );
      const cell: Cell = {
        id: t.id, sea, fill, rings: sphereRings,
        pos: ll2v(t.lat, t.lon, 1.012),
        surf: ll2v(t.lat, t.lon, 1.02),
        display: t.display, victoryCity: !!t.victoryCity,
      };
      cells.push(cell);
      byId.set(t.id, cell);
    }
    return { cells, byId };
  }, []);
}

function Province({ cell, state, selected, targets, range, battles, onPick, onHoverTerr }: { cell: Cell } & Props) {
  const isSel = selected === cell.id;
  const isTarget = targets.has(cell.id);
  const isRange = !!range?.has(cell.id);
  const isBattle = battles.has(cell.id);
  const hot = isSel || isTarget || isBattle || isRange;
  const color = isBattle ? "#e07a68" : isTarget ? "#5ad98a" : isRange ? "#3fd0e0" : isSel ? "#e6c25a" : controllerColor(state, cell.id);
  // Land fills are kept light so the satellite terrain reads through; sea
  // fills are essentially invisible unless interactive.
  const opacity = cell.sea ? (hot ? 0.3 : 0.012) : hot ? 0.46 : 0.16;
  const lineColor = isSel ? "#ffe08a" : cell.sea ? "#2a5a82" : "#0a1c2e";
  const lineOpacity = hot ? (cell.sea ? 0.55 : 0.8) : cell.sea ? 0.12 : 0.5;
  const lineW = isSel ? 2.4 : cell.sea ? 0.35 : 0.6;
  return (
    <>
      <mesh
        geometry={cell.fill}
        onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onPick(cell.id); }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; onHoverTerr?.(cell.id); }}
        onPointerOut={() => { document.body.style.cursor = "default"; onHoverTerr?.(null); }}
      >
        <meshBasicMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {cell.rings.map((ring, i) =>
        ring.length > 1 ? (
          <Line key={i} points={ring} color={lineColor} lineWidth={lineW} transparent opacity={lineOpacity} />
        ) : null,
      )}
    </>
  );
}

/** Tilt a child group so +Y points away from the globe centre at `pos`. */
function standing(pos: THREE.Vector3): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(Y, pos.clone().normalize());
}

/**
 * drei <Html> overlays are DOM elements painted over the canvas, so without
 * help they shine straight through the earth. This wrapper hides the content
 * whenever its surface anchor is on the far side of the globe (a point p on a
 * sphere of radius R is visible from camera c iff p·c > R²), and optionally
 * cross-fades by zoom bucket via `fade` (returns 0..1 opacity from a ZoomRef).
 */
function SurfaceHtml({
  anchor, children, fade, ...rest
}: { anchor: THREE.Vector3; fade?: () => number } & React.ComponentProps<typeof Html>) {
  const ref = useRef<HTMLDivElement>(null);
  useFrame(({ camera }) => {
    const el = ref.current;
    if (!el) return;
    const visible = anchor.dot(camera.position) > R * R;
    const o = fade ? fade() : 1;
    if (!visible || o <= 0.01) {
      el.style.visibility = "hidden";
    } else {
      el.style.visibility = "visible";
      el.style.opacity = String(o);
    }
  });
  return (
    <Html {...rest}>
      <div ref={ref}>{children}</div>
    </Html>
  );
}

/**
 * Per-territory force layer. Renders, depending on zoom:
 *   far  — a single coloured force DOT (controller colour, white ring) sized by
 *          stack strength; no models, no count chip.
 *   mid  — 3D models + a count chip on real stacks; the dot fades out.
 *   near — full models + chips.
 * Everything fades by opacity (no popping) and there is no per-frame setState.
 */
function Stack({ cell, state, zoom }: { cell: Cell; state: GameState; zoom: React.MutableRefObject<ZoomRef> }) {
  const ts = state.territories[cell.id];
  const units = ts?.units ?? [];
  const total = units.reduce((n, u) => n + u.count, 0);
  if (total === 0 && !cell.victoryCity) return null;
  const owner = units[0]?.owner ?? ts?.controller;
  const ownerColor = owner ? POWERS[owner].color : "#cccccc";
  const quat = standing(cell.pos);

  // Group ALL present unit types by owner so each owner gets its own row of
  // type-models; structures sort first within a row. Multiple allied owners in
  // one sea zone end up as parallel rows, side by side.
  const byOwner = new Map<PowerId, UnitStack[]>();
  for (const u of units) {
    if (u.count <= 0) continue;
    const arr = byOwner.get(u.owner) ?? [];
    arr.push(u);
    byOwner.set(u.owner, arr);
  }
  const ownerRows = [...byOwner.entries()].map(([oid, arr]) => ({
    owner: oid,
    // structures first, then mobile by descending count, for a stable layout
    stacks: [...arr].sort((a, b) => {
      const sa = STRUCTURES.has(a.type) ? 0 : 1;
      const sb = STRUCTURES.has(b.type) ? 0 : 1;
      return sa - sb || b.count - a.count;
    }),
  }));
  const maxRowLen = Math.max(1, ...ownerRows.map((r) => r.stacks.length));
  const spread = 0.02; // gap between models within a row
  const rowGap = 0.022; // gap between owner rows
  const baseW = maxRowLen * spread;
  const baseD = ownerRows.length * rowGap;
  // Cluster scale grows with stack strength but is reined back in when the grid
  // itself is wide/deep (many types or owners) so a dense province's pile-grid
  // still fits inside its own footprint and never overlaps neighbours.
  const gridSpan = Math.max(baseW, baseD);
  const fit = THREE.MathUtils.clamp(0.16 / Math.max(0.16, gridSpan), 0.6, 1);
  const clusterScale = Math.min(2.2, 1.05 + Math.log2(total + 1) * 0.2) * fit;
  // Force-dot radius scales mildly with stack strength.
  const dotScale = Math.min(1.7, 0.7 + Math.log2(total + 1) * 0.16);

  // Refs for per-frame visibility/opacity toggling of the 3D model group and
  // the force dot — both driven by the zoom bucket, no React re-render.
  const modelRef = useRef<THREE.Group>(null);
  const dotRef = useRef<THREE.Group>(null);
  const dotMat = useRef<THREE.MeshBasicMaterial>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    const d = zoom.current.detail; // 1 near → 0 far
    const m = modelRef.current;
    if (m) {
      const show = d > 0.12;
      m.visible = show;
      if (show) {
        const s = clusterScale * THREE.MathUtils.clamp((d - 0.12) / 0.4, 0.4, 1);
        m.scale.setScalar(s);
      }
    }
    const g = dotRef.current;
    if (g) {
      const o = THREE.MathUtils.clamp(1 - (d - 0.18) / 0.32, 0, 1); // visible far/mid
      g.visible = o > 0.02;
      if (dotMat.current) dotMat.current.opacity = o * 0.92;
      if (ringMat.current) ringMat.current.opacity = o;
    }
  });

  return (
    <group position={cell.pos} quaternion={quat}>
      {/* Force dot (far/mid) — flat disc tangent to the surface. */}
      {total > 0 && (
        <group ref={dotRef} scale={dotScale} position={[0, 0.006, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0.0001]}>
            <circleGeometry args={[0.016, 24]} />
            <meshBasicMaterial ref={ringMat} color="#ffffff" transparent opacity={1} depthWrite={false} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0002, 0]}>
            <circleGeometry args={[0.0125, 24]} />
            <meshBasicMaterial ref={dotMat} color={ownerColor} transparent opacity={0.92} depthWrite={false} />
          </mesh>
        </group>
      )}

      {/* base plate so the models pop against terrain, + the per-type grid.
          Each owner is a row (offset in Z); within a row each unit TYPE is a
          model standing on its own chip pile (chips encode the count). */}
      <group ref={modelRef}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0008, 0]}>
          <circleGeometry args={[0.02 + Math.max(baseW, baseD) * 0.5, 28]} />
          <meshBasicMaterial color="#0c1018" transparent opacity={0.28} depthWrite={false} />
        </mesh>
        {ownerRows.map((row, ri) => {
          const z = (ri - (ownerRows.length - 1) / 2) * rowGap;
          const rc = POWERS[row.owner]?.color ?? ownerColor;
          return (
            <group key={row.owner} position={[0, 0, z]}>
              {row.stacks.map((u, i) => {
                const x = (i - (row.stacks.length - 1) / 2) * spread;
                return (
                  <group key={u.type} position={[x, 0, 0]}>
                    <ChipPile count={u.count} />
                    <group position={[0, pileHeight(u.count), 0]}>
                      <UnitModel type={u.type} color={rc} />
                    </group>
                  </group>
                );
              })}
            </group>
          );
        })}
      </group>

      {cell.victoryCity && (
        <mesh position={[0, 0.052, 0]}>
          <octahedronGeometry args={[0.008]} />
          <meshStandardMaterial color="#e6c25a" emissive="#7a5a10" roughness={0.5} />
        </mesh>
      )}
      {/* Small TOTAL badge — mid zoom only. At full near detail the chip piles
          carry the count, so this fades out to avoid clutter; far zoom uses the
          force dot instead. Peaks in the mid band, fades at both ends. */}
      {total > 1 && (
        <SurfaceHtml
          anchor={cell.pos}
          position={[0, 0.06, 0]}
          center
          distanceFactor={1.7}
          zIndexRange={[10, 0]}
          fade={() => {
            const d = zoom.current.detail; // 1 near → 0 far
            const fadeIn = THREE.MathUtils.clamp((d - 0.18) / 0.22, 0, 1); // appears leaving far
            const fadeOut = THREE.MathUtils.clamp((0.82 - d) / 0.22, 0, 1); // gone entering near
            return Math.min(fadeIn, fadeOut);
          }}
        >
          <div className="globe-chip">
            <span className="globe-chip-dot" style={{ background: ownerColor }} />
            <span className="globe-chip-n">{total}</span>
          </div>
        </SurfaceHtml>
      )}
    </group>
  );
}

/** Slerp along the surface; aircraft arc higher, ships/land hug the surface. */
function arcPoint(from: THREE.Vector3, to: THREE.Vector3, t: number, air: boolean): THREE.Vector3 {
  const f = from.clone().normalize();
  const g = to.clone().normalize();
  const dot = THREE.MathUtils.clamp(f.dot(g), -1, 1);
  const omega = Math.acos(dot);
  let p: THREE.Vector3;
  if (omega < 1e-4) {
    p = f.clone();
  } else {
    const s1 = Math.sin((1 - t) * omega) / Math.sin(omega);
    const s2 = Math.sin(t * omega) / Math.sin(omega);
    p = f.multiplyScalar(s1).add(g.multiplyScalar(s2)).normalize();
  }
  const lift = (air ? 0.22 : 0.02) * Math.sin(Math.PI * t);
  return p.multiplyScalar(1.02 + lift);
}

function MovingPiece({ from, to, type, color, onDone }: {
  from: THREE.Vector3; to: THREE.Vector3; type: UnitTypeId; color: string; onDone: () => void;
}) {
  const ref = useRef<THREE.Group>(null);
  const t = useRef(0);
  const air = UNITS[type]?.domain === "air";
  useFrame((_, dt) => {
    t.current = Math.min(1, t.current + dt / 1.15);
    const p = arcPoint(from, to, t.current, air);
    const g = ref.current;
    if (g) {
      g.position.copy(p);
      g.quaternion.setFromUnitVectors(Y, p.clone().normalize());
    }
    if (t.current >= 1) onDone();
  });
  return (
    <group ref={ref}>
      <group scale={1.25}><UnitModel type={type} color={color} /></group>
    </group>
  );
}

function MovementLayer({ lastMove, byId }: { lastMove: Props["lastMove"]; byId: Map<string, Cell> }) {
  const [anims, setAnims] = useState<Array<{ nonce: number; from: THREE.Vector3; to: THREE.Vector3; type: UnitTypeId; color: string }>>([]);
  useEffect(() => {
    if (!lastMove) return;
    const a = byId.get(lastMove.from);
    const b = byId.get(lastMove.to);
    if (!a || !b) return;
    const color = POWERS[lastMove.owner as PowerId]?.color ?? "#ffffff";
    setAnims((cur) => [...cur, { nonce: lastMove.nonce, from: a.surf, to: b.surf, type: lastMove.type, color }]);
  }, [lastMove?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {anims.map((a) => (
        <MovingPiece
          key={a.nonce}
          from={a.from}
          to={a.to}
          type={a.type}
          color={a.color}
          onDone={() => setAnims((cur) => cur.filter((x) => x.nonce !== a.nonce))}
        />
      ))}
    </>
  );
}

function Globe() {
  const texture = useLoader(THREE.TextureLoader, EARTH_SRC);
  const oceanGeo = useMemo(() => new THREE.SphereGeometry(R * 0.999, 96, 96), []);
  const terrainGeo = useMemo(() => geoSphere(R, 96), []);
  const atmoGeo = useMemo(() => new THREE.SphereGeometry(R * 1.045, 48, 48), []);
  return (
    <>
      {/* Ocean: fully matte so there is NO harsh specular band on the sphere. */}
      <mesh geometry={oceanGeo}><meshStandardMaterial color="#11476f" roughness={1} metalness={0} /></mesh>
      <mesh geometry={terrainGeo}><meshStandardMaterial map={texture} roughness={1} metalness={0} /></mesh>
      {/* Atmosphere rim: a slightly larger back-side sphere glowing faint blue so
          the globe edge feathers gently into space instead of a hard cut. */}
      <mesh geometry={atmoGeo}>
        <meshBasicMaterial color="#5b8fd6" transparent opacity={0.12} side={THREE.BackSide} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </>
  );
}

/** Sea zones flagged for special rules: kamikaze defence and convoy raiding. */
function useZones(cells: Cell[], state: GameState): { kami: Set<string>; convoy: Set<string> } {
  return useMemo(() => {
    const kami = new Set<string>();
    const convoy = new Set<string>();
    const kamiLive = (state.kamikaze ?? 0) > 0;
    for (const c of cells) {
      if (!c.sea) continue;
      const ts = state.territories[c.id];
      if (kamiLive && neighbours(c.id).some((n) => KAMIKAZE_ISLANDS.has(n) && state.territories[n]?.controller === "Japan")) {
        kami.add(c.id);
      }
      const shipOwners = new Set(ts.units.filter((u) => WARSHIPS.has(u.type)).map((u) => u.owner));
      if (shipOwners.size) {
        for (const n of neighbours(c.id)) {
          if (isSea(n)) continue;
          const lt = state.territories[n];
          const d = TERRITORY_INDEX[n];
          if (!lt?.controller || !d || d.ipc <= 0) continue;
          if ([...shipOwners].some((o) => areEnemies(state, o, lt.controller!))) { convoy.add(c.id); break; }
        }
      }
    }
    return { kami, convoy };
  }, [cells, state]);
}

/**
 * Drives the shared zoom state once per frame: updates `dist` always, and only
 * flips `bucket` when crossing a threshold so dependent React state is rare.
 */
function ZoomDriver({ zoom, onBucket }: { zoom: React.MutableRefObject<ZoomRef>; onBucket: (b: ZoomBucket) => void }) {
  useFrame(({ camera }) => {
    const dist = camera.position.length();
    zoom.current.dist = dist;
    // detail: 1 at/below NEAR_MAX, 0 at/above FAR_MIN, linear between.
    zoom.current.detail = THREE.MathUtils.clamp((FAR_MIN - dist) / (FAR_MIN - NEAR_MAX), 0, 1);
    const b: ZoomBucket = dist < NEAR_MAX ? "near" : dist > FAR_MIN ? "far" : "mid";
    if (b !== zoom.current.bucket) {
      zoom.current.bucket = b;
      onBucket(b);
    }
  });
  return null;
}

function Scene(props: Props) {
  const { cells, byId } = useCells();
  const zones = useZones(cells, props.state);
  const zoom = useRef<ZoomRef>({ dist: 2.5, bucket: "mid", detail: 0.5 });
  const [, setBucket] = useState<ZoomBucket>("mid"); // coarse, rarely changes
  const victoryCells = useMemo(() => cells.filter((c) => c.victoryCity), [cells]);
  // Capitals always labelled; other victory cities fade in approaching mid zoom.
  const capitals = useMemo(() => {
    const caps = new Set<string>();
    for (const p of Object.values(POWERS)) if (p.capital) caps.add(p.capital);
    return caps;
  }, []);

  return (
    <>
      {/* Soft, warm key light + cool hemisphere fill — no hard specular band. */}
      <hemisphereLight color="#bcd2f0" groundColor="#0a1322" intensity={0.7} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 3, 5]} intensity={0.55} color="#fff3e0" />
      <Stars radius={50} depth={20} count={1500} factor={2} fade />

      <React.Suspense fallback={<mesh><sphereGeometry args={[R, 48, 48]} /><meshStandardMaterial color="#11476f" roughness={1} /></mesh>}>
        <Globe />
      </React.Suspense>

      {cells.map((c) => (
        <Province key={c.id} cell={c} {...props} />
      ))}
      {cells.map((c) => (
        <Stack key={`s-${c.id}`} cell={c} state={props.state} zoom={zoom} />
      ))}
      {victoryCells.map((c) => {
        const cap = capitals.has(c.id);
        return (
          <SurfaceHtml
            key={`l-${c.id}`}
            anchor={c.pos}
            position={c.pos.clone().multiplyScalar(1.12).toArray()}
            center
            distanceFactor={cap ? 2.1 : 1.9}
            zIndexRange={[10, 0]}
            // Capitals always visible; other cities fade in by mid zoom.
            fade={cap ? undefined : () => THREE.MathUtils.clamp((zoom.current.detail - 0.12) / 0.4, 0, 1)}
          >
            <div className={`globe-label${cap ? " capital" : ""}`}>
              <span className="globe-star">★</span>
              <span className="globe-label-text">{c.display}</span>
            </div>
          </SurfaceHtml>
        );
      })}

      {/* Special-rule sea-zone markers: kamikaze defence & convoy raiding. */}
      {cells.filter((c) => zones.kami.has(c.id)).map((c) => (
        <SurfaceHtml key={`kz-${c.id}`} anchor={c.pos} position={c.pos.toArray()} center distanceFactor={2.2} zIndexRange={[8, 0]}>
          <div className="zone-badge kami" title="Kamikaze zone — Japanese island defence">鬼</div>
        </SurfaceHtml>
      ))}
      {cells.filter((c) => zones.convoy.has(c.id)).map((c) => (
        <SurfaceHtml key={`cz-${c.id}`} anchor={c.pos} position={c.pos.toArray()} center distanceFactor={2.2} zIndexRange={[8, 0]}>
          <div className="zone-badge convoy" title="Convoy raid — enemy warships disrupting income here">!</div>
        </SurfaceHtml>
      ))}

      <MovementLayer lastMove={props.lastMove} byId={byId} />

      <ZoomDriver zoom={zoom} onBucket={setBucket} />
      <OrbitControls enablePan={false} rotateSpeed={0.45} minDistance={1.25} maxDistance={4} enableDamping dampingFactor={0.08} />
    </>
  );
}

export function GlobeBoard(props: Props) {
  return (
    <div className="board-inner">
      <Canvas camera={{ position: [2.25, 1.2, -0.48], fov: 45 }} dpr={[1, 2]}>
        <color attach="background" args={["#05080f"]} />
        <Scene {...props} />
      </Canvas>
      <div className="globe-hint">
        <span>Drag to rotate · scroll / pinch to zoom · tap a province to select</span>
        <span className="chip-legend" title="Each model = one unit type; the discs beneath it count that type (model itself = 1).">
          <span className="chip-legend-sep">·</span>
          chips:
          <span className="chip-swatch" style={{ background: "#d2403a" }} />5
          <span className="chip-swatch" style={{ background: "#e7c14a" }} />3
          <span className="chip-swatch" style={{ background: "#9aa3b0" }} />1
        </span>
      </div>
    </div>
  );
}
