import React from "react";
import type { PanelProps } from "./types.js";
import { MoveControls } from "./MoveControls.js";

// Non-combat movement: reposition units and land aircraft. No combat
// affordances (no transport assaults into enemy land, no SBR) — MoveControls
// already gates those on the combat_move phase.

export function NonCombatPanel(props: PanelProps) {
  const { view, actingAs } = props;
  const { state } = view;
  const active = actingAs ?? state.activePower;
  return (
    <MoveControls
      state={state}
      active={active}
      selectedTerr={props.selectedTerr}
      selectedUnit={props.selectedUnit}
      selectedCount={props.selectedCount}
      setSelectedUnit={props.setSelectedUnit}
      setSelectedCount={props.setSelectedCount}
      setHoverUnit={props.setHoverUnit}
      act={props.act}
      busy={props.busy}
    />
  );
}
