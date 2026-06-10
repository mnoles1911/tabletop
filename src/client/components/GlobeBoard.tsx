import React, { useMemo } from "react";
import { Canvas, useLoader, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Line, Html, Stars } from "@react-three/drei";
import * as THREE from "three";
import { geoVoronoi } from "d3-geo-voronoi";
import {
  TERRITORIES,
  POWERS,
  isSea,
  hasFlag,
  type GameState,
  type PowerId,
} from "@engine/index";

// ============================================================================
// 3D globe renderer (three.js / react-three-fiber). The world is a textured
// sphere (NASA Blue Marble); the A&A provinces are a spherical-Voronoi division
// of the territory positions, drawn as translucent control regions with
// boundary lines. Units and factories are 3D pieces standing on the surface.
// Rotate/zoom with orbit controls — a globe is inherently a single seamless
// world, so there is no edge or blank space.
// ============================================================================

const R = 1;
const EARTH_SRC = `${import.meta.env.BASE_URL}earth.jpg`;
const DEG = Math.PI / 180;

/** Geographic (lat, lon) -> 3D point on a sphere aligned with an equirectangular texture. */
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
  return c ? POWERS[c as PowerId].color : "#7a869c";
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
  def: (typeof TERRITORIES)[number];
  fill: THREE.BufferGeometry;
  border: [number, number, number][];
  pos: THREE.Vector3; // surface point for pieces/labels
}

/** Build the spherical-Voronoi province cells once (territory positions are static). */
function useCells(): Cell[] {
  return useMemo(() => {
    const points = TERRITORIES.map((t) => [t.lon, t.lat]);
    const polys = geoVoronoi(points).polygons();
    return TERRITORIES.map((t, i) => {
      const feature = polys.features[i];
      const ring: [number, number][] = feature?.geometry?.coordinates?.[0] ?? [];
      // Fan-triangulate the (convex) Voronoi cell from its site for a filled region.
      const site = ll2v(t.lat, t.lon, 1.002);
      const positions: number[] = [];
      for (let k = 0; k < ring.length - 1; k++) {
        const a = ll2v(ring[k][1], ring[k][0], 1.002);
        const b = ll2v(ring[k + 1][1], ring[k + 1][0], 1.002);
        positions.push(site.x, site.y, site.z, a.x, a.y, a.z, b.x, b.y, b.z);
      }
      const fill = new THREE.BufferGeometry();
      fill.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      fill.computeVertexNormals();
      const border = ring.map(([lon, lat]) => {
        const v = ll2v(lat, lon, 1.004);
        return [v.x, v.y, v.z] as [number, number, number];
      });
      return { id: t.id, sea: isSea(t.id), def: t, fill, border, pos: ll2v(t.lat, t.lon, 1.01) };
    });
  }, []);
}

function Province({ cell, state, selected, targets, battles, onPick }: { cell: Cell } & Props) {
  const isSel = selected === cell.id;
  const isTarget = targets.has(cell.id);
  const isBattle = battles.has(cell.id);
  const color = isBattle ? "#d96a5a" : isTarget ? "#5ad98a" : isSel ? "#d9b24a" : controllerColor(state, cell.id);
  const opacity = cell.sea ? (isSel || isTarget || isBattle ? 0.35 : 0.04) : isSel || isTarget || isBattle ? 0.6 : 0.42;
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
      {cell.border.length > 1 && (
        <Line points={cell.border} color={isSel ? "#ffe08a" : "#0c2236"} lineWidth={isSel ? 2 : 0.6} transparent opacity={cell.sea ? 0.35 : 0.7} />
      )}
    </>
  );
}

function Piece({ cell, state }: { cell: Cell; state: GameState }) {
  const ts = state.territories[cell.id];
  const total = ts?.units.reduce((n, u) => n + u.count, 0) ?? 0;
  if (total === 0 && !cell.def.victoryCity) return null;
  const owner = ts?.units[0]?.owner ?? ts?.controller;
  const color = owner ? POWERS[owner].color : "#cccccc";
  const hasFactory = ts?.units.some((u) => hasFlag(u.type, "factory"));
  const up = cell.pos.clone().normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  return (
    <group position={cell.pos} quaternion={quat}>
      {total > 0 && (
        <mesh position={[0, 0.012, 0]}>
          <coneGeometry args={[0.012, 0.03, 6]} />
          <meshStandardMaterial color={color} />
        </mesh>
      )}
      {hasFactory && (
        <mesh position={[0.02, 0.008, 0]}>
          <boxGeometry args={[0.016, 0.016, 0.016]} />
          <meshStandardMaterial color="#9aa3b2" />
        </mesh>
      )}
      {cell.def.victoryCity && (
        <mesh position={[0, 0.05, 0]}>
          <octahedronGeometry args={[0.01]} />
          <meshStandardMaterial color="#d9b24a" emissive="#7a5a10" />
        </mesh>
      )}
      {total > 0 && (
        <Html position={[0, 0.07, 0]} center distanceFactor={1.6} zIndexRange={[10, 0]}>
          <div className="globe-chip">⚔{total}</div>
        </Html>
      )}
    </group>
  );
}

function Scene(props: Props) {
  const cells = useCells();
  const texture = useLoader(THREE.TextureLoader, EARTH_SRC);

  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight position={[5, 3, 5]} intensity={1.1} />
      <Stars radius={50} depth={20} count={1500} factor={2} fade />

      {/* Textured Earth */}
      <mesh>
        <sphereGeometry args={[R, 96, 96]} />
        <meshStandardMaterial map={texture} roughness={1} metalness={0} />
      </mesh>

      {/* Province control regions + boundaries */}
      {cells.map((c) => (
        <Province key={c.id} cell={c} {...props} />
      ))}

      {/* 3D unit & factory pieces */}
      {cells.map((c) => (
        <Piece key={`p-${c.id}`} cell={c} state={props.state} />
      ))}

      {/* Capital / victory-city labels */}
      {cells.filter((c) => c.def.victoryCity).map((c) => (
        <Html key={`l-${c.id}`} position={c.pos.clone().multiplyScalar(1.13).toArray()} center distanceFactor={2} zIndexRange={[10, 0]}>
          <div className="globe-label">★ {c.def.display}</div>
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
  // Initial camera roughly over Europe / the Atlantic.
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
