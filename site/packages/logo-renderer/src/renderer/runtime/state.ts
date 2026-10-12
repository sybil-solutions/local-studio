import type { MutableRefObject } from "react";
import type { MeshData, RenderControls } from "../render";

// Mutable animation state owned by index.tsx's renderer lifecycle.
export type HeroRuntimeState = {
  cancelled: boolean;
  renderRequested: boolean;
  cleanup: (() => void) | undefined;
  mouseEnvYaw: number;
  targetMouseEnvYaw: number;
  mouseEnvPitch: number;
  targetMouseEnvPitch: number;
  asciiMouseX: number;
  asciiMouseY: number;
  targetAsciiMouseX: number;
  targetAsciiMouseY: number;
  brushCellX: number;
  brushCellY: number;
  previousRenderedBrushCellX: number;
  previousRenderedBrushCellY: number;
  hasBrushCell: boolean;
  hasRenderedBrushCell: boolean;
  brushActive: boolean;
  paintGridScaleMultiplier: number;
  targetBrushActive: boolean;
  activeMesh: MeshData | undefined;
  previousFrameTime: number;
  autoRotateStartTime: number;
  lastBrushMoveTime: number;
  lastPointerClientX: number | undefined;
  lastPointerClientY: number | undefined;
  rippleCellX: number;
  rippleCellY: number;
  rippleStartTime: number;
  lastRippleSpawnTime: number;
  pointerInsideCanvas: boolean;
  isCoarsePointer: boolean;
  staticPose: boolean;
};

export type ControlsRef = MutableRefObject<RenderControls>;
