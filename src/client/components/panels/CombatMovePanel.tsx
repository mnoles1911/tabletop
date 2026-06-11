import React from "react";
import { TERRITORY_INDEX } from "@engine/index";
import type { PanelProps } from "./types.js";
import { MoveControls } from "./MoveControls.js";

// Combat movement: move/transport/bomb units into hostile territory, with a
// running list of the battles those moves have declared.

export function CombatMovePanel(props: PanelProps) {
  const { view, actingAs } = props;
  const { state } = view;
  const active = actingAs ?? state.activePower;
  const battles = state.combat.battles.filter((b) => !b.resolved);
  return (
    <div>
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
      {battles.length > 0 && (
        <div className="mt">
          <div className="section-title">Declared battles</div>
          {battles.map((b) => (
            <div className="buy-row" key={b.territory}>
              <span>{TERRITORY_INDEX[b.territory]?.display ?? b.territory}</span>
              <span className="hint">
                {b.amphibious && <span title="Amphibious assault">⚓ </span>}
                {b.sbr && <span title="Strategic bombing raid">✈ </span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
