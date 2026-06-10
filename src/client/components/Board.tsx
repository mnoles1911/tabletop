import React, { useMemo, useRef, useState } from "react";
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

function controllerColor(state: GameState, id: string): string {
  if (isSea(id)) return "#143456";
  const ctrl = state.territories[id]?.controller;
  return ctrl ? POWERS[ctrl as PowerId].color : "#3a4658";
}

const totalUnits = (state: GameState, id: string): number =>
  state.territories[id]?.units.reduce((n, u) => n + u.count, 0) ?? 0;

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
      const s2 = Math.min(6, Math.max(1, p.s * factor));
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

  const edges = useMemo(() => {
    const seen = new Set<string>();
    const segs: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    for (const t of TERRITORIES) {
      for (const n of neighbours(t.id)) {
        const key = [t.id, n].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        const a = TERRITORY_INDEX[t.id];
        const b = TERRITORY_INDEX[n];
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
          <radialGradient id="seaGrad" cx="50%" cy="40%" r="80%">
            <stop offset="0%" stopColor="#173b5e" />
            <stop offset="100%" stopColor="#0c2238" />
          </radialGradient>
        </defs>
        <rect x="-200" y="-200" width="600" height="600" fill="url(#seaGrad)" />

        <g transform={`translate(${vt.t.x} ${vt.t.y}) scale(${vt.t.s})`}>
          {edges.map((e, i) => (
            <line key={i} className="adj-line" x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
          ))}

          {TERRITORIES.map((t) => {
            const sea = isSea(t.id);
            const total = totalUnits(state, t.id);
            const cls = [
              "terr",
              selected === t.id ? "selected" : "",
              targets.has(t.id) ? "target" : "",
              battles.has(t.id) ? "battle" : "",
            ].join(" ").trim();
            const w = sea ? 7 : 7.4;
            const h = sea ? 5 : 5.6;
            return (
              <g key={t.id} className={cls} onClick={() => pick(t.id)}>
                {sea ? (
                  <ellipse className="terr-shape" cx={t.x} cy={t.y} rx={w / 2} ry={h / 2} fill={controllerColor(state, t.id)} opacity={0.55} />
                ) : (
                  <rect className="terr-shape" x={t.x - w / 2} y={t.y - h / 2} width={w} height={h} rx={1.1} fill={controllerColor(state, t.id)} />
                )}
                {t.victoryCity && <text className="cap-star" x={t.x} y={t.y - h / 2 - 0.3}>★</text>}
                <text className="terr-label" x={t.x} y={t.y - 0.4}>
                  {t.display.length > 13 ? t.display.slice(0, 12) + "…" : t.display}
                </text>
                {total > 0 && <text className="terr-units" x={t.x} y={t.y + 1.7}>⚔ {total}</text>}
                {!sea && t.ipc > 0 && <text className="terr-ipc" x={t.x} y={t.y + h / 2 + 1.5}>{t.ipc}</text>}
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
