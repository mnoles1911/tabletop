import React from "react";
import {
  POWERS,
  territoryIncome,
  collectibleIncome,
  nationalObjectiveBonus,
  convoyLoss,
} from "@engine/index";
import type { PanelProps } from "./types.js";

// Collect income phase: the income summary; End Turn lives in the Sidebar foot.

export function EndTurnPanel({ view, actingAs }: PanelProps) {
  const { state } = view;
  const active = actingAs ?? state.activePower;
  const base = territoryIncome(state, active);
  const no = nationalObjectiveBonus(state, active);
  const convoy = convoyLoss(state, active);
  const total = collectibleIncome(state, active);
  return (
    <div className="hint mt">
      Territory income: <b>{base}</b>
      {no > 0 && <> + National Objectives <b style={{ color: "var(--gold)" }}>{no}</b></>}
      {convoy > 0 && <> − convoy raids <b style={{ color: "var(--danger)" }}>{convoy}</b></>}.
      <br />This turn {POWERS[active].display} banks <b style={{ color: "var(--gold)" }}>{total} IPC</b>. End the turn to collect.
    </div>
  );
}
