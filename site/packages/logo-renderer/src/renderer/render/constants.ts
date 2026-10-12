// Renderer numeric constants, GPU formats, and public defaults.
// INVARIANT: Pure move from render.ts; keep shader ABI, binding order, and pixel output unchanged.
// Imported by render/renderer.ts and re-exported only through render.ts facade.

import type { EveMaterial } from "./types";

export const PARAMS_BYTE_SIZE = 176;
export const CUBE_MAX_LIGHTS = 16;
export const CUBE_LIGHT_FLOAT_COUNT = 12;
export const CUBE_PARAMS_FLOAT_COUNT = 4 + CUBE_MAX_LIGHTS * CUBE_LIGHT_FLOAT_COUNT;
export const CUBE_PARAMS_BYTE_SIZE = CUBE_PARAMS_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT;
export const CUBE_SIZE = 256;
export const CUBE_FACE_COUNT = 6;
// eve.dev ships the studio cube as rgba16float; 8-bit sRGB (added here only for
// the removed photo-atlas upload path) clips HDR softbox luminance above 1.0.
export const CUBE_FORMAT: GPUTextureFormat = "rgba16float";
export const BLOOM_RADIUS = 16;
export const SCENE_FORMAT: GPUTextureFormat = "rgba16float";
// 4x MSAA on the main scene pass keeps logo silhouette/bevel edges clean
// without paying supersampled fragment cost for the material shaders.
export const SCENE_SAMPLE_COUNT = 4;
export const BLOOM_STRENGTH = 0.85;
export const BLOOM_STRENGTH_OFF = BLOOM_STRENGTH;
export const BLOOM_STRENGTH_ON = BLOOM_STRENGTH_OFF * 0.25;
export const BLOOM_THRESHOLD = 0;
export const BACK_DEPTH_FORMAT: GPUTextureFormat = "depth32float";

// The shader renders the back side first, then the front side. Keeping two passes
// preserves the acrylic depth/overlap cues while avoiding a depth buffer.
export const PASS_INSIDE = 0;
export const PASS_OUTSIDE = 1;
export const PASS_WIREFRAME = 2;
export const MATERIAL_KIND = {
  glass: 0,
  normal: 1,
  "camera reflected normal": 2,
  metallic: 3,
  "back-albedo": 0,
  "back-depth": 0,
  thickness: 4,
  "paint-debug": 0,
} satisfies Record<EveMaterial, number>;
export const CAMERA_CLIP_PADDING = 0.02;
export const BASELINE_CAMERA_RADIUS = 1.9;
export const BASELINE_CAMERA_FOV = 35;
export const DEFAULT_CAMERA_FOV = BASELINE_CAMERA_FOV / 2;
export const DEFAULT_OBJECT_YAW = -0.1;
export const EVE_THICKNESS_SCALE_MULTIPLIER = 1.3;
export const PREVIEW_BACK_ALBEDO = 0;
export const PREVIEW_BACK_DEPTH = 1;
export const DEFAULT_IMPRINT_CELL_SIZE = 16;
export const REFERENCE_IMPRINT_LOGICAL_HEIGHT = 1200;
export const DEFAULT_IMPRINT_DEVICE_PIXEL_RATIO = 2;
export const DEFAULT_IMPRINT_GRID_SCALE_MULTIPLIER = 0.71;
export const DEFAULT_IMPRINT_GLYPH_SCALE = 1.35;
export const PAINT_FORMAT: GPUTextureFormat = "r32float";
export const PAINT_STATIC_NOISE_FORMAT: GPUTextureFormat = "rgba32float";
export const VORONOI_NOISE_FORMAT: GPUTextureFormat = "r32float";
export const PAINT_PARAMS_BYTE_SIZE = 48;
export const VORONOI_NOISE_PARAMS_BYTE_SIZE = 16;
export const DEFAULT_PAINT_DECAY_PER_FRAME_120 = 0.032;
export const DEFAULT_PAINT_DECAY_RATE = DEFAULT_PAINT_DECAY_PER_FRAME_120 * 120;
export const DEFAULT_PAINT_DIFFUSION_RATE = 1.6;
export const DEFAULT_PAINT_DIFFUSION_JITTER = 4.0;
export const DEFAULT_PAINT_BRUSH_RADIUS = 3;
export const DEFAULT_PAINT_BRUSH_STRENGTH = 32.0;
export const DEFAULT_PAINT_DT = 1 / 60;
export const PAINT_STROKE_MOVEMENT_EPSILON_CELLS = 0.05;

function safeDevicePixelRatioOrDefault(devicePixelRatio: number | undefined) {
  const ratio =
    devicePixelRatio !== undefined && Number.isFinite(devicePixelRatio)
      ? devicePixelRatio
      : DEFAULT_IMPRINT_DEVICE_PIXEL_RATIO;

  return Math.max(0.001, ratio);
}

export function imprintCellSizeForLogicalHeight(logicalHeight: number) {
  const safeLogicalHeight =
    Number.isFinite(logicalHeight)
      ? logicalHeight
      : REFERENCE_IMPRINT_LOGICAL_HEIGHT;

  return (
    DEFAULT_IMPRINT_CELL_SIZE * (Math.max(1, safeLogicalHeight) / REFERENCE_IMPRINT_LOGICAL_HEIGHT)
  );
}

export function imprintGridSizeForLogicalSize(
  logicalWidth: number,
  logicalHeight: number,
  gridScaleMultiplier = DEFAULT_IMPRINT_GRID_SCALE_MULTIPLIER,
) {
  const cellSize = imprintCellSizeForLogicalHeight(logicalHeight);
  const multiplierScale =
    Math.max(0.001, gridScaleMultiplier) / DEFAULT_IMPRINT_GRID_SCALE_MULTIPLIER;
  return {
    cols: Math.max(1, Math.ceil((logicalWidth / cellSize) * multiplierScale)),
    rows: Math.max(1, Math.ceil((logicalHeight / cellSize) * multiplierScale)),
  };
}

export function imprintCellSizeForDevicePixelRatio(
  devicePixelRatio = DEFAULT_IMPRINT_DEVICE_PIXEL_RATIO,
) {
  return (
    DEFAULT_IMPRINT_CELL_SIZE *
    (safeDevicePixelRatioOrDefault(devicePixelRatio) / DEFAULT_IMPRINT_DEVICE_PIXEL_RATIO)
  );
}

export function bloomRadiusForDevicePixelRatio(
  devicePixelRatio = DEFAULT_IMPRINT_DEVICE_PIXEL_RATIO,
) {
  return Math.max(
    0,
    Math.round(
      BLOOM_RADIUS *
        (safeDevicePixelRatioOrDefault(devicePixelRatio) / DEFAULT_IMPRINT_DEVICE_PIXEL_RATIO),
    ),
  );
}
