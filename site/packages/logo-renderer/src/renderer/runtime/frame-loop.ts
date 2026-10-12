import type { Surface } from "vgpu";
import { clamp01, lerp } from "phase/ease";
import { evePointerInteractionMode, mobileAutoEnvYaw } from "../mobile-motion";
import {
  DEFAULT_OBJECT_YAW,
  DEFAULT_PAINT_BRUSH_RADIUS,
  DEFAULT_PAINT_BRUSH_STRENGTH,
  DEFAULT_PAINT_DECAY_PER_FRAME_120,
  DEFAULT_PAINT_DIFFUSION_JITTER,
  DEFAULT_PAINT_DIFFUSION_RATE,
  type ImprintRenderOptions,
  type RenderControls,
} from "../render";
import {
  getCanvasLogicalSize,
  resizeCanvas,
  type CanvasLayoutRef,
  type DevicePixelRatioRef,
} from "./canvas-sizing";
import type { ControlsRef, HeroRuntimeState } from "./state";

const ENV_ROTATION_LERP_SPEED = 2.5;
const ASCII_MOUSE_LERP_SPEED = 6;
const RIPPLE_DURATION_SECONDS = 1.0;
const RIPPLE_STRENGTH = 18.0;
const RIPPLE_IDLE_INTERVAL_MS = 2400;
const PAINT_MOVEMENT_GRACE_MS = 72;
const PAINT_SETTLE_DURATION_MS = 750;
const IMPRINT_GRID_SCALE_MULTIPLIER = 0.9;
const IMPRINT_GLYPH_SCALE = 1.27;
const CANVAS_REVEAL_RENDER_COUNT = 3;
const MAX_FRAME_DELTA_SECONDS = 0.05;
const MOBILE_AUTO_ROTATE_DURATION_MS = 2000;
const SETTLE_EPSILON = 0.0005;
const POINTER_OBJECT_YAW_RANGE = 0.42;
const POINTER_OBJECT_PITCH_RANGE = 0.2;
const MOBILE_OBJECT_YAW_RANGE = 0.28;
const MOBILE_OBJECT_PITCH_RANGE = 0.08;

type Renderer = {
  render: (
    target: Surface,
    controls: RenderControls,
    logicalWidth: number,
    logicalHeight: number,
    imprint?: ImprintRenderOptions,
  ) => void;
};

export type DrawLoop = {
  start: () => void;
  stop: () => void;
  step: (frameTime?: number) => boolean;
  dispose: () => void;
};

export function createDrawLoop({
  state,
  canvas,
  surface: canvasSurface,
  renderer,
  controlsRef,
  canvasLayoutRef,
  devicePixelRatioRef,
  onCanvasRevealed,
  onFallback,
  onFatalError,
}: {
  state: HeroRuntimeState;
  canvas: HTMLCanvasElement;
  surface: Surface;
  renderer: Renderer;
  controlsRef: ControlsRef;
  canvasLayoutRef: CanvasLayoutRef;
  devicePixelRatioRef: DevicePixelRatioRef;
  onCanvasRevealed: () => void;
  onFallback: () => void;
  onFatalError: () => void;
}) {
  let successfulRenderCount = 0;
  let running = false;

  const draw = (frameTime = performance.now()) => {
    if (!running || state.cancelled) return false;

    const pointerSettling =
      Math.abs(state.mouseEnvYaw - state.targetMouseEnvYaw) > SETTLE_EPSILON ||
      Math.abs(state.mouseEnvPitch - state.targetMouseEnvPitch) > SETTLE_EPSILON ||
      Math.abs(state.asciiMouseX - state.targetAsciiMouseX) > SETTLE_EPSILON ||
      Math.abs(state.asciiMouseY - state.targetAsciiMouseY) > SETTLE_EPSILON;
    const autoRotating =
      evePointerInteractionMode(state.isCoarsePointer).autoRotateEnvYaw &&
      frameTime - state.autoRotateStartTime < MOBILE_AUTO_ROTATE_DURATION_MS;
    const paintSettling = frameTime - state.lastBrushMoveTime < PAINT_SETTLE_DURATION_MS;
    const idleRippleDue =
      state.pointerInsideCanvas &&
      state.hasBrushCell &&
      frameTime - state.lastBrushMoveTime > RIPPLE_IDLE_INTERVAL_MS &&
      frameTime - state.lastRippleSpawnTime > RIPPLE_IDLE_INTERVAL_MS;
    if (idleRippleDue) {
      state.rippleCellX = state.brushCellX;
      state.rippleCellY = state.brushCellY;
      state.rippleStartTime = frameTime;
      state.lastRippleSpawnTime = frameTime;
    }
    const rippleAge = (frameTime - state.rippleStartTime) / 1000;
    const rippleActive = rippleAge >= 0 && rippleAge < RIPPLE_DURATION_SECONDS;
    if (
      successfulRenderCount >= CANVAS_REVEAL_RENDER_COUNT &&
      !state.renderRequested &&
      !pointerSettling &&
      !autoRotating &&
      !paintSettling &&
      !rippleActive &&
      // Hovering keeps the loop alive: idle ripples and the shimmer animate.
      !state.pointerInsideCanvas
    ) {
      state.previousFrameTime = frameTime;
      return false;
    }
    state.renderRequested = false;

    const deltaSeconds = Math.min(
      MAX_FRAME_DELTA_SECONDS,
      Math.max(0, (frameTime - state.previousFrameTime) / 1000),
    );
    state.previousFrameTime = frameTime;
    if (evePointerInteractionMode(state.isCoarsePointer).autoRotateEnvYaw) {
      state.targetMouseEnvYaw = mobileAutoEnvYaw((frameTime - state.autoRotateStartTime) / 1000);
      state.targetMouseEnvPitch = 0;
      state.targetBrushActive = false;
    }
    state.mouseEnvYaw = lerp(
      state.mouseEnvYaw,
      state.targetMouseEnvYaw,
      clamp01(deltaSeconds * ENV_ROTATION_LERP_SPEED),
    );
    state.mouseEnvPitch = lerp(
      state.mouseEnvPitch,
      state.targetMouseEnvPitch,
      clamp01(deltaSeconds * ENV_ROTATION_LERP_SPEED),
    );
    state.asciiMouseX = lerp(
      state.asciiMouseX,
      state.targetAsciiMouseX,
      clamp01(deltaSeconds * ASCII_MOUSE_LERP_SPEED),
    );
    state.asciiMouseY = lerp(
      state.asciiMouseY,
      state.targetAsciiMouseY,
      clamp01(deltaSeconds * ASCII_MOUSE_LERP_SPEED),
    );
    state.brushActive = state.targetBrushActive && state.hasBrushCell;
    controlsRef.current.envYaw = state.mouseEnvYaw;
    controlsRef.current.envPitch = state.mouseEnvPitch;
    if (evePointerInteractionMode(state.isCoarsePointer).autoRotateEnvYaw) {
      controlsRef.current.yaw =
        DEFAULT_OBJECT_YAW + Math.sin(state.mouseEnvYaw) * MOBILE_OBJECT_YAW_RANGE;
      controlsRef.current.pitch =
        Math.cos(state.mouseEnvYaw * 0.7) * MOBILE_OBJECT_PITCH_RANGE;
    } else {
      // Orbit-follow: positive yaw/pitch move the camera right/up, so the face
      // reads as turning away from the pointer. Invert both so the mark tracks
      // the cursor: cursor right -> face right, cursor up -> face up.
      controlsRef.current.yaw =
        DEFAULT_OBJECT_YAW - state.asciiMouseX * POINTER_OBJECT_YAW_RANGE;
      controlsRef.current.pitch = state.asciiMouseY * POINTER_OBJECT_PITCH_RANGE;
    }

    const devicePixelRatio = resizeCanvas(canvas, canvasLayoutRef, devicePixelRatioRef);
    canvasSurface.resize([canvas.width, canvas.height]);
    const { logicalWidth, logicalHeight } = getCanvasLogicalSize(canvas, devicePixelRatio);

    try {
      const brushPreviousCell: readonly [number, number] = state.hasRenderedBrushCell
        ? [state.previousRenderedBrushCellX, state.previousRenderedBrushCellY]
        : [state.brushCellX, state.brushCellY];
      const brushCanWrite =
        state.brushActive && frameTime - state.lastBrushMoveTime <= PAINT_MOVEMENT_GRACE_MS;
      state.paintGridScaleMultiplier = IMPRINT_GRID_SCALE_MULTIPLIER;
      renderer.render(
        canvasSurface,
        controlsRef.current,
        logicalWidth,
        logicalHeight,
        {
          progress: 0,
          gridScaleMultiplier: IMPRINT_GRID_SCALE_MULTIPLIER,
          glyphScale: IMPRINT_GLYPH_SCALE,
          time: frameTime / 1000,
          mouse: [state.asciiMouseX, state.asciiMouseY],
          devicePixelRatio,
          paint: {
            dt: deltaSeconds,
            brushCell: [state.brushCellX, state.brushCellY],
            brushPreviousCell,
            brushRadius: DEFAULT_PAINT_BRUSH_RADIUS * 1.5,
            brushStrength: DEFAULT_PAINT_BRUSH_STRENGTH,
            brushActive: brushCanWrite,
            decayRate: DEFAULT_PAINT_DECAY_PER_FRAME_120 * 120,
            diffusionRate: DEFAULT_PAINT_DIFFUSION_RATE,
            diffusionJitter: DEFAULT_PAINT_DIFFUSION_JITTER,
            ripple: rippleActive
              ? {
                  center: [state.rippleCellX, state.rippleCellY],
                  age: rippleAge,
                  strength: RIPPLE_STRENGTH,
                }
              : undefined,
          },
        },
      );
      if (state.hasBrushCell) {
        state.previousRenderedBrushCellX = state.brushCellX;
        state.previousRenderedBrushCellY = state.brushCellY;
        state.hasRenderedBrushCell = true;
      }
    } catch {
      state.cancelled = true;
      onFallback();
      onFatalError();
      return false;
    }

    successfulRenderCount += 1;
    if (successfulRenderCount === CANVAS_REVEAL_RENDER_COUNT) {
      onCanvasRevealed();
    }
    return true;
  };

  const start = () => {
    if (running) return;
    running = true;
    const frameTime = performance.now();
    state.previousFrameTime = frameTime;
    state.renderRequested = true;
    if (evePointerInteractionMode(state.isCoarsePointer).autoRotateEnvYaw) {
      state.autoRotateStartTime = frameTime;
    }
  };

  const stop = () => {
    running = false;
  };

  return {
    start,
    stop,
    step: draw,
    dispose: stop,
  };
}
