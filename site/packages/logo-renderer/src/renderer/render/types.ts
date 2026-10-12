// Renderer domain types and GPU resource shapes.
// INVARIANT: Pure move from render.ts; keep shader ABI, binding order, and pixel output unchanged.
// Imported by render/renderer.ts and re-exported only through render.ts facade.

import type { Geometry, PingPongTargets, Target } from "vgpu";
import type { Texture } from "vgpu/core";

export type Bounds = {
  min: [number, number, number];
  max: [number, number, number];
};

export type MeshData = {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  bounds: Bounds;
};

export type EveMaterial =
  | "glass"
  | "normal"
  | "camera reflected normal"
  | "metallic"
  | "back-albedo"
  | "back-depth"
  | "thickness"
  | "paint-debug";

export type PaintSeed = {
  width: number;
  height: number;
  values: Float32Array;
};

export type PaintStroke = {
  fromCell: readonly [number, number];
  toCell: readonly [number, number];
  duration?: number;
  movementGated?: boolean;
};

export type PaintRenderOptions = {
  seed?: PaintSeed | undefined;
  steps?: number | undefined;
  dt?: number | undefined;
  brushCell?: readonly [number, number];
  brushPreviousCell?: readonly [number, number];
  brushRadius?: number;
  brushStrength?: number;
  brushActive?: boolean;
  decayRate?: number;
  diffusionRate?: number;
  diffusionJitter?: number;
  stroke?: PaintStroke | undefined;
  decaySteps?: number | undefined;
  ripple?: { readonly center: readonly [number, number]; readonly age: number; readonly strength: number } | undefined;
};

export type ImprintRenderOptions = {
  progress?: number;
  gridScaleMultiplier?: number;
  glyphScale?: number;
  time?: number;
  mouse?: readonly [number, number];
  paint?: PaintRenderOptions;
  devicePixelRatio?: number;
};

export type RenderControls = {
  yaw: number;
  pitch: number;
  radius: number;
  fov: number;
  envYaw: number;
  envPitch: number;
  insideRendering: boolean;
  outsideRendering: boolean;
  material: EveMaterial;
  wireframe: boolean;
  showEnv: boolean;
};

export type PaintPointerRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PaintPointerMappingInput = {
  clientX: number;
  clientY: number;
  rect: PaintPointerRect;
  canvasWidth: number;
  canvasHeight: number;
  logicalWidth: number;
  logicalHeight: number;
  controls: Pick<RenderControls, "radius" | "yaw" | "pitch" | "fov">;
  meshBounds: Bounds;
  gridScaleMultiplier?: number;
  paddingRadius?: number;
  devicePixelRatio?: number;
};

export type PaintPointerMapping = {
  physical: readonly [number, number];
  logical: readonly [number, number];
  model: readonly [number, number];
  brushCell: readonly [number, number];
  originCell: readonly [number, number];
  gridScale: number;
  pxPerModelUnit: number;
  insideLogicalBounds: boolean;
};

export type GpuMesh = {
  triangles: Geometry;
  lines: Geometry;
};

export type StudioCubemap = {
  texture: Texture;
  view: GPUTextureView;
  sampler: GPUSampler;
};

export type Mat4 = Float32Array;
export type Vec3 = [number, number, number];

export type EnvLightConfig = {
  name: string;
  position: readonly [number, number, number];
  color: string;
  intensity: number;
  radius: number;
  softness: number;
  luminance: number;
};

export type BloomTargets = {
  width: number;
  height: number;
  scene: Target;
  backMaterial: Target | undefined;
  backDepth: Target | undefined;
  bloom: PingPongTargets;
};

export type PaintTargets = {
  cols: number;
  rows: number;
  paint: PingPongTargets;
  staticNoise: Target;
  voronoi: Target;
};
