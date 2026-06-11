import React, { useMemo } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Line, Html, Stars } from "@react-three/drei";
import * as THREE from "three";
import {
  TERRITORIES,
  BORDERS,
  POWERS,
  isSea,
  hasFlag,
  type GameState,
  type PowerId,
} from "@engine/index";

// ============================================================================
// 3D globe renderer (three.js / react-three-fiber).
//
// The world is a sphere whose continents ARE the Axis & Allies provinces: each
// territory's real board outline (from the open-source TripleA map data) is
// projected to lon/lat and wrapped onto the sphere, so the historic provinces
// overlap exactly as they do on the board. Land provinces are terrain-tinted
// control regions; sea zones stay faint until selected. Units, factories and
// victory cities are 3D pieces on the surface. Rotate/zoom freely — a globe is
// inherently one seamless world with no edge.
// ============================================================================

const R = 1;
const DEG = Math.PI / 180;

/** Geographic (lat, lon) -> point on a sphere aligned with an equirectangular layout. */
function ll2v(lat: number, lon: number, r = R): THREE.Vector3 {
  const phi = (90 - lat) * DEG;
  const theta = (lon + 180) * DEG;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
}

function controllerColor(state: GameState, id: string): string {
  if (isSea(id)) return "#1b5fa0";
  const c = state.territories[id]?.controller;
  return c ? POWERS[c as PowerId].color : "#6b7689";
}

interface Props {
  state: GameState;
  selected: string | null;
  targets: Set<string>;
  battles: Set<string>;
  onPick: (id: string) => void;
}

interface Cell {
  id: string;
  sea: boolean;
  fill: THREE.BufferGeometry;
  rings: [number, number, number][][]; // border line points (sphere space)
  pos: THREE.Vector3; // surface point for pieces/labels
  display: string;
  victoryCity: boolean;
}

/**
 * Triangulate a province's lon/lat rings and lift them onto the sphere. We
 * ear-clip in the lon/lat plane (provinces are small enough that the planar
 * triangulation maps cleanly to the curved surface), then project each vertex.
 */
function buildFill(rings: [number, number][][], radius: number): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const ring of rings) {
    let pts = ring;
    if (pts.length > 2) {
      const [fx, fy] = pts[0];
      const [lx, ly] = pts[pts.length - 1];
      if (fx === lx && fy === ly) pts = pts.slice(0, -1); // drop closing dup
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

/** Build the province cells once — the map geometry is static. */
function useCells(): Cell[] {
  return useMemo(() => {
    const cells: Cell[] = [];
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
      cells.push({
        id: t.id,
        sea,
        fill,
        rings: sphereRings,
        pos: ll2v(t.lat, t.lon, 1.012),
        display: t.display,
        victoryCity: !!t.victoryCity,
      });
    }
    return cells;
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
          <Line
            key={i}
            points={ring}
            color={lineColor}
            lineWidth={isSel ? 2.2 : cell.sea ? 0.4 : 0.7}
            transparent
            opacity={cell.sea ? 0.25 : 0.65}
          />
        ) : null,
      )}
    </>
  );
}

function Piece({ cell, state }: { cell: Cell; state: GameState }) {
  const ts = state.territories[cell.id];
  const total = ts?.units.reduce((n, u) => n + u.count, 0) ?? 0;
  if (total === 0 && !cell.victoryCity) return null;
  const owner = ts?.units[0]?.owner ?? ts?.controller;
  const color = owner ? POWERS[owner].color : "#cccccc";
  const hasFactory = ts?.units.some((u) => hasFlag(u.type, "factory"));
  const up = cell.pos.clone().normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  return (
    <group position={cell.pos} quaternion={quat}>
      {total > 0 && (
        <mesh position={[0, 0.01, 0]}>
          <coneGeometry args={[0.009, 0.024, 6]} />
          <meshStandardMaterial color={color} />
        </mesh>
      )}
      {hasFactory && (
        <mesh position={[0.016, 0.006, 0]}>
          <boxGeometry args={[0.012, 0.012, 0.012]} />
          <meshStandardMaterial color="#9aa3b2" />
        </mesh>
      )}
      {cell.victoryCity && (
        <mesh position={[0, 0.04, 0]}>
          <octahedronGeometry args={[0.008]} />
          <meshStandardMaterial color="#d9b24a" emissive="#7a5a10" />
        </mesh>
      )}
      {total > 0 && (
        <Html position={[0, 0.055, 0]} center distanceFactor={1.4} zIndexRange={[10, 0]}>
          <div className="globe-chip">⚔{total}</div>
        </Html>
      )}
    </group>
  );
}

function Scene(props: Props) {
  const cells = useCells();

  return (
    <>
      <ambientLight intensity={0.85} />
      <directionalLight position={[5, 3, 5]} intensity={1.05} />
      <Stars radius={50} depth={20} count={1500} factor={2} fade />

      {/* Ocean sphere — the provinces themselves form the continents on top. */}
      <mesh>
        <sphereGeometry args={[R, 96, 96]} />
        <meshStandardMaterial color="#0f3a63" roughness={0.85} metalness={0.05} />
      </mesh>

      {cells.map((c) => (
        <Province key={c.id} cell={c} {...props} />
      ))}
      {cells.map((c) => (
        <Piece key={`p-${c.id}`} cell={c} state={props.state} />
      ))}
      {cells.filter((c) => c.victoryCity).map((c) => (
        <Html key={`l-${c.id}`} position={c.pos.clone().multiplyScalar(1.12).toArray()} center distanceFactor={2} zIndexRange={[10, 0]}>
          <div className="globe-label">★ {c.display}</div>
        </Html>
      ))}

      <OrbitControls
        enablePan={false}
        rotateSpeed={0.45}
        minDistance={1.25}
        maxDistance={4}
        enableDamping
        dampingFactor={0.08}
      />
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
