import React, { useMemo } from "react";
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

/** Compact "3 inf, 1 tank" style summary of the units in a territory. */
function unitSummary(state: GameState, id: string): { total: number } {
  const total = state.territories[id]?.units.reduce((n, u) => n + u.count, 0) ?? 0;
  return { total };
}

export function Board({ state, selected, targets, battles, onPick }: Props) {
  // Pre-compute adjacency line segments once (static map graph).
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

  return (
    <svg className="map" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="seaGrad" cx="50%" cy="40%" r="80%">
          <stop offset="0%" stopColor="#173b5e" />
          <stop offset="100%" stopColor="#0c2238" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="100" height="100" fill="url(#seaGrad)" />

      {edges.map((e, i) => (
        <line key={i} className="adj-line" x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
      ))}

      {TERRITORIES.map((t) => {
        const sea = isSea(t.id);
        const { total } = unitSummary(state, t.id);
        const cls = [
          "terr",
          selected === t.id ? "selected" : "",
          targets.has(t.id) ? "target" : "",
          battles.has(t.id) ? "battle" : "",
        ].join(" ").trim();
        const w = sea ? 7 : 7.2;
        const h = sea ? 5 : 5.4;
        return (
          <g key={t.id} className={cls} onClick={() => onPick(t.id)}>
            {sea ? (
              <ellipse className="terr-shape" cx={t.x} cy={t.y} rx={w / 2} ry={h / 2} fill={controllerColor(state, t.id)} opacity={0.55} />
            ) : (
              <rect className="terr-shape" x={t.x - w / 2} y={t.y - h / 2} width={w} height={h} rx={1.1} fill={controllerColor(state, t.id)} />
            )}
            {t.victoryCity && <text className="cap-star" x={t.x} y={t.y - h / 2 - 0.3}>★</text>}
            <text className="terr-label" x={t.x} y={t.y - 0.4}>{t.display.length > 14 ? t.display.slice(0, 13) + "…" : t.display}</text>
            {total > 0 && <text className="terr-units" x={t.x} y={t.y + 1.6}>⚔ {total}</text>}
            {!sea && t.ipc > 0 && <text className="terr-ipc" x={t.x} y={t.y + h / 2 + 1.4}>{t.ipc}</text>}
          </g>
        );
      })}
    </svg>
  );
}
