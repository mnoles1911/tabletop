import type { Action, PowerId, UnitTypeId } from "@engine/index";
import type { GameView } from "../../api.js";

/** Shared props threaded from the Sidebar to every phase panel. */
export interface PanelProps {
  view: GameView;
  canAct: boolean;
  /** The power the local player is acting as (expectedActor when it's yours). */
  actingAs: PowerId | null;
  selectedTerr: string | null;
  selectedUnit: UnitTypeId | null;
  selectedCount: number;
  setSelectedUnit: (u: UnitTypeId | null) => void;
  setSelectedCount: (n: number) => void;
  mobilizeUnit: UnitTypeId | null;
  setMobilizeUnit: (u: UnitTypeId | null) => void;
  setHoverUnit: (h: { territory: string; type: UnitTypeId } | null) => void;
  /** Dispatch an action, optionally as a specific power (defender out of turn). */
  act: (a: Action, as?: PowerId) => void;
  busy: boolean;
}
