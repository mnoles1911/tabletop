import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useLoader, useFrame, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Line, Html, Stars } from "@react-three/drei";
import * as THREE from "three";
import {
  TERRITORIES,
  BORDERS,
  POWERS,
  UNITS,
  isSea,
  type GameState,
  type PowerId,
  type UnitTypeId,
} from "@engine/index";

// ============================================================================
// 3D globe renderer (three.js / react-three-fiber).
//
// The world is a sphere whose continents ARE the Axis & Allies provinces (real
// board outlines wrapped onto the sphere) over a faint daytime satellite layer.
// Forces are little 3D models — infantry, tanks, planes, warships, factories —
// standing on the surface, sized by stack strength. Moves animate: land units
// slide, ships sail along the surface, aircraft arc overhead.
// ============================================================================

const R = 1;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const Y = new THREE.Vector3(0, 1, 0);
const EARTH_SRC = `${import.meta.env.BASE_URL}earth_day.jpg`;

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
// stand upright on the globe surface.

const STEEL = "#c2c9d4";
const DARK = "#20242c";

function UnitModel({ type, color }: { type: UnitTypeId; color: string }) {
  switch (type) {
    case "infantry":
      return (
        <group>
          <mesh position={[0, 0.009, 0]}><capsuleGeometry args={[0.004, 0.01, 3, 6]} /><meshStandardMaterial color={color} /></mesh>
          <mesh position={[0, 0.018, 0]}><sphereGeometry args={[0.0045, 8, 8]} /><meshStandardMaterial color={color} /></mesh>
        </group>
      );
    case "mech_infantry":
      return (
        <group>
          <mesh position={[0, 0.006, 0]}><boxGeometry args={[0.02, 0.008, 0.01]} /><meshStandardMaterial color={color} /></mesh>
          <mesh position={[0.004, 0.015, 0]}><capsuleGeometry args={[0.0035, 0.008, 3, 6]} /><meshStandardMaterial color={color} /></mesh>
        </group>
      );
    case "artillery":
      return (
        <group>
          <mesh position={[0, 0.005, 0]}><boxGeometry args={[0.012, 0.008, 0.01]} /><meshStandardMaterial color={color} /></mesh>
          <mesh position={[0.012, 0.012, 0]} rotation={[0, 0, -0.7]}><cylinderGeometry args={[0.0016, 0.0016, 0.022, 8]} /><meshStandardMaterial color={DARK} /></mesh>
        </group>
      );
    case "tank":
      return (
        <group>
          <mesh position={[0, 0.006, 0]}><boxGeometry args={[0.022, 0.009, 0.013]} /><meshStandardMaterial color={color} metalness={0.3} roughness={0.6} /></mesh>
          <mesh position={[0, 0.014, 0]}><boxGeometry args={[0.012, 0.007, 0.01]} /><meshStandardMaterial color={color} /></mesh>
          <mesh position={[0.016, 0.014, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.0015, 0.0015, 0.018, 8]} /><meshStandardMaterial color={DARK} /></mesh>
        </group>
      );
    case "aa_gun":
      return (
        <group>
          <mesh position={[0, 0.005, 0]}><boxGeometry args={[0.012, 0.007, 0.012]} /><meshStandardMaterial color={color} /></mesh>
          <mesh position={[0, 0.016, 0]} rotation={[0.5, 0, 0]}><cylinderGeometry args={[0.0012, 0.0012, 0.018, 6]} /><meshStandardMaterial color={DARK} /></mesh>
        </group>
      );
    case "fighter":
    case "tactical_bomber":
    case "strategic_bomber": {
      const big = type === "strategic_bomber" ? 1.5 : type === "tactical_bomber" ? 1.2 : 1;
      return (
        <group position={[0, 0.03, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh><coneGeometry args={[0.005 * big, 0.026 * big, 8]} /><meshStandardMaterial color={color} metalness={0.4} roughness={0.5} /></mesh>
          <mesh position={[0, 0.002, 0]}><boxGeometry args={[0.03 * big, 0.001, 0.006 * big]} /><meshStandardMaterial color={color} /></mesh>
          <mesh position={[0, -0.011 * big, 0]}><boxGeometry args={[0.012 * big, 0.001, 0.004 * big]} /><meshStandardMaterial color={color} /></mesh>
        </group>
      );
    }
    case "submarine":
      return (
        <group position={[0, 0.003, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh><capsuleGeometry args={[0.004, 0.024, 4, 8]} /><meshStandardMaterial color={DARK} metalness={0.5} roughness={0.5} /></mesh>
          <mesh position={[0, 0.001, 0.005]}><boxGeometry args={[0.004, 0.006, 0.004]} /><meshStandardMaterial color={DARK} /></mesh>
        </group>
      );
    case "destroyer":
    case "cruiser":
    case "battleship":
    case "aircraft_carrier":
    case "transport": {
      const len = type === "battleship" || type === "aircraft_carrier" ? 0.04 : type === "cruiser" ? 0.032 : 0.026;
      const wide = type === "aircraft_carrier" ? 0.016 : 0.01;
      return (
        <group position={[0, 0.004, 0]}>
          <mesh rotation={[0, 0, 0]}><boxGeometry args={[len, 0.006, wide]} /><meshStandardMaterial color={color} metalness={0.3} roughness={0.6} /></mesh>
          {type === "aircraft_carrier" && (
            <mesh position={[0, 0.005, 0]}><boxGeometry args={[len * 0.95, 0.001, wide * 0.85]} /><meshStandardMaterial color={STEEL} /></mesh>
          )}
          {(type === "cruiser" || type === "battleship") && (
            <mesh position={[0, 0.009, 0]}><boxGeometry args={[len * 0.3, 0.008, wide * 0.6]} /><meshStandardMaterial color={STEEL} /></mesh>
          )}
          {type === "battleship" && (
            <mesh position={[len * 0.28, 0.009, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.0012, 0.0012, 0.012, 6]} /><meshStandardMaterial color={DARK} /></mesh>
          )}
          {type === "transport" && (
            <mesh position={[0, 0.008, 0]}><boxGeometry args={[len * 0.5, 0.006, wide * 0.8]} /><meshStandardMaterial color="#7a6a44" /></mesh>
          )}
          {type === "destroyer" && (
            <mesh position={[0, 0.008, 0]}><boxGeometry args={[len * 0.2, 0.006, wide * 0.5]} /><meshStandardMaterial color={STEEL} /></mesh>
          )}
        </group>
      );
    }
    case "major_ic":
    case "minor_ic": {
      const big = type === "major_ic" ? 1.3 : 1;
      return (
        <group>
          <mesh position={[0, 0.008 * big, 0]}><boxGeometry args={[0.02 * big, 0.016 * big, 0.016 * big]} /><meshStandardMaterial color="#8a8f99" metalness={0.2} roughness={0.8} /></mesh>
          <mesh position={[0.006 * big, 0.02 * big, 0]}><cylinderGeometry args={[0.0022, 0.0022, 0.012 * big, 8]} /><meshStandardMaterial color="#5a5f68" /></mesh>
        </group>
      );
    }
    case "air_base":
      return (
        <group>
          <mesh position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.016, 16]} /><meshStandardMaterial color="#3a3f47" /></mesh>
          <mesh position={[0.008, 0.008, 0]}><boxGeometry args={[0.004, 0.014, 0.004]} /><meshStandardMaterial color={STEEL} /></mesh>
        </group>
      );
    case "naval_base":
      return (
        <group>
          <mesh position={[0, 0.004, 0]}><boxGeometry args={[0.018, 0.006, 0.01]} /><meshStandardMaterial color="#6a6f78" /></mesh>
        </group>
      );
    default:
      return (
        <mesh position={[0, 0.01, 0]}><coneGeometry args={[0.008, 0.02, 6]} /><meshStandardMaterial color={color} /></mesh>
      );
  }
}

interface Props {
  state: GameState;
  selected: string | null;
  targets: Set<string>;
  battles: Set<string>;
  onPick: (id: string) => void;
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

function Province({ cell, state, selected, targets, battles, onPick }: { cell: Cell } & Props) {
  const isSel = selected === cell.id;
  const isTarget = targets.has(cell.id);
  const isBattle = battles.has(cell.id);
  const hot = isSel || isTarget || isBattle;
  const color = isBattle ? "#d96a5a" : isTarget ? "#5ad98a" : isSel ? "#d9b24a" : controllerColor(state, cell.id);
  const opacity = cell.sea ? (hot ? 0.32 : 0.015) : hot ? 0.7 : 0.5;
  const lineColor = isSel ? "#ffe08a" : cell.sea ? "#1d4a6e" : "#0b1f33";
  return (
    <>
      <mesh
        geometry={cell.fill}
        onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onPick(cell.id); }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { document.body.style.cursor = "default"; }}
      >
        <meshBasicMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {cell.rings.map((ring, i) =>
        ring.length > 1 ? (
          <Line key={i} points={ring} color={lineColor} lineWidth={isSel ? 2.2 : cell.sea ? 0.4 : 0.7} transparent opacity={cell.sea ? 0.25 : 0.65} />
        ) : null,
      )}
    </>
  );
}

/** Tilt a child group so +Y points away from the globe centre at `pos`. */
function standing(pos: THREE.Vector3): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(Y, pos.clone().normalize());
}

function Stack({ cell, state }: { cell: Cell; state: GameState }) {
  const ts = state.territories[cell.id];
  const units = ts?.units ?? [];
  const total = units.reduce((n, u) => n + u.count, 0);
  if (total === 0 && !cell.victoryCity) return null;
  const owner = units[0]?.owner ?? ts?.controller;
  const ownerColor = owner ? POWERS[owner].color : "#cccccc";
  const quat = standing(cell.pos);

  // Show the up-to-three most numerous unit types as little models in a row.
  const top = [...units].sort((a, b) => b.count - a.count).slice(0, 3);
  const spread = 0.02;
  const clusterScale = Math.min(1.8, 0.85 + Math.log2(total + 1) * 0.18);

  return (
    <group position={cell.pos} quaternion={quat}>
      <group scale={clusterScale}>
        {top.map((u, i) => (
          <group key={`${u.type}-${u.owner}`} position={[(i - (top.length - 1) / 2) * spread, 0, 0]}>
            <UnitModel type={u.type} color={POWERS[u.owner]?.color ?? ownerColor} />
          </group>
        ))}
      </group>
      {cell.victoryCity && (
        <mesh position={[0, 0.052, 0]}>
          <octahedronGeometry args={[0.008]} />
          <meshStandardMaterial color="#d9b24a" emissive="#7a5a10" />
        </mesh>
      )}
      {total > 0 && (
        <Html position={[0, 0.06, 0]} center distanceFactor={1.4} zIndexRange={[10, 0]}>
          <div className="globe-chip">⚔{total}</div>
        </Html>
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
  return (
    <>
      <mesh geometry={oceanGeo}><meshStandardMaterial color="#13456e" roughness={0.9} metalness={0.05} /></mesh>
      <mesh geometry={terrainGeo}><meshStandardMaterial map={texture} transparent opacity={0.5} roughness={1} metalness={0} depthWrite={false} /></mesh>
    </>
  );
}

function Scene(props: Props) {
  const { cells, byId } = useCells();
  return (
    <>
      <ambientLight intensity={0.95} />
      <directionalLight position={[5, 3, 5]} intensity={1.05} />
      <Stars radius={50} depth={20} count={1500} factor={2} fade />

      <React.Suspense fallback={<mesh><sphereGeometry args={[R, 48, 48]} /><meshStandardMaterial color="#13456e" /></mesh>}>
        <Globe />
      </React.Suspense>

      {cells.map((c) => (
        <Province key={c.id} cell={c} {...props} />
      ))}
      {cells.map((c) => (
        <Stack key={`s-${c.id}`} cell={c} state={props.state} />
      ))}
      {cells.filter((c) => c.victoryCity).map((c) => (
        <Html key={`l-${c.id}`} position={c.pos.clone().multiplyScalar(1.12).toArray()} center distanceFactor={2} zIndexRange={[10, 0]}>
          <div className="globe-label">★ {c.display}</div>
        </Html>
      ))}

      <MovementLayer lastMove={props.lastMove} byId={byId} />

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
      <div className="globe-hint">Drag to rotate · scroll / pinch to zoom · tap a province to select</div>
    </div>
  );
}
