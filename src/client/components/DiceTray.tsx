import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

// ============================================================================
// 3D dice tray (combat theater). When a battle round is fought, the attacker's
// and defender's dice tumble onto a felt war-mat and settle showing their rolled
// values — attacker dice in red, defender dice in steel-blue. Purely cosmetic:
// the values come straight from the deterministic engine roll.
// ============================================================================

interface DiceEvent {
  atk: number[];
  def: number[];
  territory: string;
  nonce: number;
}

const IDENTITY = new THREE.Quaternion();

function randomQuat(): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(Math.random() * 12, Math.random() * 12, Math.random() * 12),
  );
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** Draw a die face (n pips) as a canvas texture. */
function pipTexture(n: number, body: string, pip: string): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  g.fillStyle = body;
  g.fillRect(0, 0, s, s);
  g.fillStyle = "rgba(0,0,0,0.12)";
  g.fillRect(0, 0, s, 6);
  g.fillRect(0, 0, 6, s);
  const q = s / 4;
  const spots: Record<number, [number, number][]> = {
    1: [[2, 2]],
    2: [[1, 1], [3, 3]],
    3: [[1, 1], [2, 2], [3, 3]],
    4: [[1, 1], [3, 1], [1, 3], [3, 3]],
    5: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]],
    6: [[1, 1], [3, 1], [1, 2], [3, 2], [1, 3], [3, 3]],
  };
  g.fillStyle = pip;
  for (const [x, y] of spots[n] ?? []) {
    g.beginPath();
    g.arc(x * q, y * q, s * 0.085, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

/** Six face materials for a die showing `value` on top, coloured by side. */
function faceMaterials(value: number, body: string, pip: string): THREE.MeshStandardMaterial[] {
  const all = [1, 2, 3, 4, 5, 6];
  const rest = all.filter((v) => v !== value && v !== 7 - value);
  const a = rest[0];
  const b = rest.find((v) => v !== a && v !== 7 - a) ?? rest[1];
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z. +y faces up = the value.
  const faces = [a, 7 - a, value, 7 - value, b, 7 - b];
  return faces.map((n) => new THREE.MeshStandardMaterial({ map: pipTexture(n, body, pip), roughness: 0.55 }));
}

function Die({ value, body, pip, position, nonce }: { value: number; body: string; pip: string; position: [number, number, number]; nonce: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const start = useMemo(() => randomQuat(), [nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = useRef(0);
  const mats = useMemo(() => faceMaterials(value, body, pip), [value, body, pip]);
  useEffect(() => { t.current = 0; }, [nonce]);
  useFrame((_, dt) => {
    t.current = Math.min(1, t.current + dt / 0.85);
    const e = easeOut(t.current);
    const m = ref.current;
    if (m) {
      m.quaternion.slerpQuaternions(start, IDENTITY, e);
      m.position.set(position[0], position[1] + Math.sin(t.current * Math.PI) * 0.45 * (1 - e), position[2]);
    }
  });
  return <mesh ref={ref} position={position} material={mats}><boxGeometry args={[0.62, 0.62, 0.62]} /></mesh>;
}

function row(values: number[], z: number, body: string, pip: string, nonce: number) {
  const span = (values.length - 1) * 0.78;
  return values.map((v, i) => (
    <Die key={`${z}-${i}`} value={v} body={body} pip={pip} position={[i * 0.78 - span / 2, 0.35, z]} nonce={nonce} />
  ));
}

export function DiceTray({ event }: { event: DiceEvent | null }) {
  const [shown, setShown] = useState<DiceEvent | null>(null);
  useEffect(() => {
    if (!event) return;
    setShown(event);
    const t = setTimeout(() => setShown(null), 3200);
    return () => clearTimeout(t);
  }, [event?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!shown) return null;
  const atk = shown.atk.slice(0, 12);
  const def = shown.def.slice(0, 12);

  return (
    <div className="dice-tray" onClick={() => setShown(null)}>
      <div className="dice-tray-head">
        🎲 {shown.territory.replace(/_/g, " ")} — <span style={{ color: "#e88" }}>attack {shown.atk.join(" ") || "—"}</span>{" · "}
        <span style={{ color: "#9bd" }}>defense {shown.def.join(" ") || "—"}</span>
      </div>
      <Canvas camera={{ position: [0, 3.4, 3.0], fov: 38 }} dpr={[1, 2]}>
        <ambientLight intensity={0.85} />
        <directionalLight position={[2, 5, 3]} intensity={1.1} castShadow />
        {/* felt war-mat */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
          <planeGeometry args={[10, 5]} />
          <meshStandardMaterial color="#2e4a32" roughness={0.95} />
        </mesh>
        {row(atk, -0.7, "#b5402f", "#fff", shown.nonce)}
        {row(def, 0.9, "#33536f", "#fff", shown.nonce)}
      </Canvas>
      <div className="dice-tray-foot">tap to dismiss</div>
    </div>
  );
}
