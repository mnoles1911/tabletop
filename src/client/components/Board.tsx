import React, { useMemo, useRef, useState } from "react";
import { Delaunay } from "d3-delaunay";
import {
  TERRITORIES,
  TERRITORY_INDEX,
  POWERS,
  isSea,
  neighbours,
  type GameState,
  type PowerId,
} from "@engine/index";

interface Props {
  state: GameState;
  selected: string | null;
  targets: Set<string>;
  battles: Set<string>;
  onPick: (territoryId: string) => void;
}

// The board is a Voronoi tessellation of the territory positions: every land
// territory and sea zone becomes a province cell with real boundary edges,
// tiling the whole world map. Land cells are coloured by controller, sea cells
// are ocean blue, and each cell is labelled at its centre. Movement links from
// the rules graph are drawn faintly on top so sea lanes / canals are legible.

const BOUNDS: [number, number, number, number] = [-4, -4, 104, 104];

function controllerColor(state: GameState, id: string): string {
  if (isSea(id)) return "#163a5c";
  const ctrl = state.territories[id]?.controller;
  return ctrl ? POWERS[ctrl as PowerId].color : "#566074";
}

const totalUnits = (state: GameState, id: string): number =>
  state.territories[id]?.units.reduce((n, u) => n + u.count, 0) ?? 0;

function centroid(poly: [number, number][]): [number, number] {
  let x = 0, y = 0;
  for (const [px, py] of poly) { x += px; y += py; }
  return [x / poly.length, y / poly.length];
}

/** Pan + pinch/scroll zoom transform, with tap-vs-drag discrimination. */
function useViewTransform() {
  const [t, setT] = useState({ s: 1, x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const last = useRef<{ x: number; y: number } | null>(null);
  const pinchDist = useRef<number | null>(null);
  const moved = useRef(false);
  const suppressClick = useRef(false);

  const pxPerUnit = () => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return 1;
    return Math.min(r.width, r.height) / 100;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    last.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchDist.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinchDist.current != null) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const factor = dist / pinchDist.current;
      pinchDist.current = dist;
      const r = svgRef.current!.getBoundingClientRect();
      zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, factor);
      moved.current = true;
      return;
    }
    if (last.current) {
      const dx = e.clientX - last.current.x;
      const dy = e.clientY - last.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved.current = true;
      const ppu = pxPerUnit();
      setT((p) => ({ ...p, x: p.x + dx / ppu, y: p.y + dy / ppu }));
      last.current = { x: e.clientX, y: e.clientY };
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchDist.current = null;
    if (pointers.current.size === 0) last.current = null;
    if (moved.current) {
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 50);
    }
  };

  const zoomAt = (px: number, py: number, factor: number) => {
    setT((p) => {
      const ppu = pxPerUnit();
      const s2 = Math.min(8, Math.max(1, p.s * factor));
      const cx = px / ppu;
      const cy = py / ppu;
      const pX = (cx - p.x) / p.s;
      const pY = (cy - p.y) / p.s;
      return { s: s2, x: cx - pX * s2, y: cy - pY * s2 };
    });
  };

  const onWheel = (e: React.WheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  };

  return { t, setT, svgRef, onPointerDown, onPointerMove, onPointerUp, onWheel, zoomAt, suppressClick };
}

function zoomCenter(vt: ReturnType<typeof useViewTransform>, factor: number) {
  const r = vt.svgRef.current?.getBoundingClientRect();
  if (!r) return;
  vt.zoomAt(r.width / 2, r.height / 2, factor);
}

export function Board({ state, selected, targets, battles, onPick }: Props) {
  const vt = useViewTransform();

  // Build the Voronoi province cells once (territory positions are static).
  const cells = useMemo(() => {
    const pts = TERRITORIES.map((t) => [t.x, t.y] as [number, number]);
    const delaunay = Delaunay.from(pts);
    const vor = delaunay.voronoi(BOUNDS);
    return TERRITORIES.map((t, i) => {
      const poly = vor.cellPolygon(i) as [number, number][] | null;
      const path = poly ? "M" + poly.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join("L") + "Z" : "";
      const [cx, cy] = poly ? centroid(poly) : [t.x, t.y];
      return { id: t.id, path, cx, cy, sea: isSea(t.id), def: t };
    });
  }, []);

  const edges = useMemo(() => {
    const seen = new Set<string>();
    const segs: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    for (const t of TERRITORIES) {
      for (const n of neighbours(t.id)) {
        const key = [t.id, n].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        const a = TERRITORY_INDEX[t.id], b = TERRITORY_INDEX[n];
        if (a && b) segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      }
    }
    return segs;
  }, []);

  const pick = (id: string) => {
    if (vt.suppressClick.current) return;
    onPick(id);
  };

  return (
    <div className="board-inner">
      <svg
        className="map"
        ref={vt.svgRef}
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={vt.onPointerDown}
        onPointerMove={vt.onPointerMove}
        onPointerUp={vt.onPointerUp}
        onPointerCancel={vt.onPointerUp}
        onWheel={vt.onWheel}
      >
        <defs>
          <radialGradient id="oceanGrad" cx="50%" cy="42%" r="75%">
            <stop offset="0%" stopColor="#0f3050" />
            <stop offset="100%" stopColor="#07182a" />
          </radialGradient>
          <filter id="landShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0.25" stdDeviation="0.3" floodColor="#03101e" floodOpacity="0.6" />
          </filter>
        </defs>
        <rect x={BOUNDS[0]} y={BOUNDS[1]} width={BOUNDS[2] - BOUNDS[0]} height={BOUNDS[3] - BOUNDS[1]} fill="url(#oceanGrad)" />

        <g transform={`translate(${vt.t.x} ${vt.t.y}) scale(${vt.t.s})`}>
          {/* Sea province cells first (background ocean tiles) */}
          {cells.filter((c) => c.sea).map((c) => {
            const cls = ["province", "sea", selected === c.id ? "selected" : "", targets.has(c.id) ? "target" : "", battles.has(c.id) ? "battle" : ""].join(" ").trim();
            return <path key={c.id} className={cls} d={c.path} fill={controllerColor(state, c.id)} onClick={() => pick(c.id)} />;
          })}

          {/* Faint movement links */}
          {edges.map((e, i) => (
            <line key={i} className="adj-line" x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
          ))}

          {/* Land province cells */}
          {cells.filter((c) => !c.sea).map((c) => {
            const cls = ["province", "land", selected === c.id ? "selected" : "", targets.has(c.id) ? "target" : "", battles.has(c.id) ? "battle" : ""].join(" ").trim();
            return <path key={c.id} className={cls} d={c.path} fill={controllerColor(state, c.id)} filter="url(#landShadow)" onClick={() => pick(c.id)} />;
          })}

          {/* Labels, unit chips, capital stars */}
          {cells.map((c) => {
            const total = totalUnits(state, c.id);
            const name = c.def.display.length > 16 ? c.def.display.slice(0, 15) + "…" : c.def.display;
            return (
              <g key={c.id} pointerEvents="none">
                {c.def.victoryCity && <text className="cap-star" x={c.cx} y={c.cy - 2.2}>★</text>}
                <text className={c.sea ? "terr-label sea-label" : "terr-label"} x={c.cx} y={c.cy - 0.2}>{name}</text>
                {!c.sea && c.def.ipc > 0 && <text className="terr-ipc" x={c.cx} y={c.cy + 1.7}>◆{c.def.ipc}</text>}
                {total > 0 && (
                  <g transform={`translate(${c.cx}, ${c.cy + (c.sea ? 1.6 : 3.4)})`}>
                    <rect className="unit-chip" x={-3} y={-1.5} width={6} height={3} rx={1.4} />
                    <text className="terr-units" x={0} y={0.7}>⚔{total}</text>
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="zoom-controls">
        <button onClick={() => zoomCenter(vt, 1.25)}>＋</button>
        <button onClick={() => zoomCenter(vt, 1 / 1.25)}>－</button>
        <button onClick={() => vt.setT({ s: 1, x: 0, y: 0 })}>⤢</button>
      </div>
    </div>
  );
}
