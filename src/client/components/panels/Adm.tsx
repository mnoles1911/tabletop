import React from "react";
import { UNITS, type UnitTypeId } from "@engine/index";

/** Compact attack / defense / movement readout shown on every unit row. */
export function Adm({ type }: { type: UnitTypeId }) {
  const u = UNITS[type];
  return (
    <span className="adm" title={`Attack ${u.attack} · Defense ${u.defense} · Move ${u.movement} · Cost ${u.cost}`}>
      ⚔{u.attack} 🛡{u.defense} 🚶{u.movement}
    </span>
  );
}
