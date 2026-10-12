// Paint ping-pong state and public vgpu effects.
import { effect, target, type Effect, type Frame, type Gpu } from "vgpu";
import paintUpdate from "../shaders/paint/paint-update.wgsl";
import {
  DEFAULT_IMPRINT_GRID_SCALE_MULTIPLIER,
  DEFAULT_PAINT_BRUSH_RADIUS,
  DEFAULT_PAINT_BRUSH_STRENGTH,
  DEFAULT_PAINT_DECAY_RATE,
  DEFAULT_PAINT_DIFFUSION_JITTER,
  DEFAULT_PAINT_DIFFUSION_RATE,
  DEFAULT_PAINT_DT,
  PAINT_FORMAT,
  PAINT_STATIC_NOISE_FORMAT,
  PAINT_STROKE_MOVEMENT_EPSILON_CELLS,
  VORONOI_NOISE_FORMAT,
  imprintGridSizeForLogicalSize,
} from "./constants";
import { mix } from "./math";
import { paintMappingMetrics } from "./pointer-mapping";
import type { RendererResources } from "./resources";
import {
  createUploadPingPong,
  createUploadTarget,
  hashPaintCell,
} from "./textures";
import type {
  ImprintRenderOptions,
  MeshData,
  PaintRenderOptions,
  PaintSeed,
  PaintTargets,
  RenderControls,
} from "./types";

function destroy(t: import("vgpu").Target) {
  t.color.destroy();
  t.depth?.destroy();
}
export function createPaintSystem(
  gpu: Gpu,
  r: RendererResources,
  mesh: MeshData,
) {
  let targets: PaintTargets | undefined;
  const stepEffects: Effect[] = [];
  const effectForStep = (step: number) => {
    const existing = stepEffects[step];
    if (existing) return existing;
    const created = effect(gpu, paintUpdate, {
      label: `eve-5-paint-step-${step}`,
    });
    stepEffects[step] = created;
    return created;
  };
  const dispose = () => {
    if (!targets) return;
    destroy(targets.paint.read);
    destroy(targets.paint.write);
    destroy(targets.staticNoise);
    destroy(targets.voronoi);
    targets = undefined;
  };
  const ensure = (w: number, h: number, m?: number) => {
    const { cols, rows } = imprintGridSizeForLogicalSize(w, h, m);
    if (targets?.cols === cols && targets.rows === rows) return targets;
    dispose();
    const staticNoise = createUploadTarget(
      gpu,
      [cols, rows],
      PAINT_STATIC_NOISE_FORMAT,
      "eve-5-paint-static-noise",
    );
    const values = new Float32Array(cols * rows * 4);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const o = (y * cols + x) * 4;
        values[o] = hashPaintCell(x, y, 0xa511e9b3);
        values[o + 1] = hashPaintCell(x, y, 0x63d83595);
        values[o + 2] = hashPaintCell(x, y, 0xf9bd1c5b);
        values[o + 3] = hashPaintCell(x, y, 0x1c4b256d);
      }
    gpu.gpu.queue.writeTexture(
      { texture: staticNoise.color.gpu },
      values,
      { bytesPerRow: cols * 16, rowsPerImage: rows },
      { width: cols, height: rows },
    );
    targets = {
      cols,
      rows,
      paint: createUploadPingPong(gpu, cols, rows, PAINT_FORMAT, "eve-5-paint"),
      staticNoise,
      voronoi: target(gpu, {
        size: [cols, rows],
        colors: [
          { format: VORONOI_NOISE_FORMAT },
          { format: VORONOI_NOISE_FORMAT },
        ],
        label: "eve-5-voronoi",
      }),
    };
    return targets;
  };
  const uploadSeed = (t: PaintTargets, seed: PaintSeed) => {
    if (
      seed.width !== t.cols ||
      seed.height !== t.rows ||
      seed.values.length !== t.cols * t.rows
    )
      throw new Error(
        `Paint seed dimensions do not match paint grid ${t.cols}×${t.rows}.`,
      );
    gpu.gpu.queue.writeTexture(
      { texture: t.paint.read.color.gpu },
      new Float32Array(seed.values),
      { bytesPerRow: t.cols * 4, rowsPerImage: t.rows },
      { width: t.cols, height: t.rows },
    );
  };
  const stepOptions = (
    paint: PaintRenderOptions,
    step: number,
    steps: number,
  ): PaintRenderOptions => {
    const stroke = paint.stroke;
    if (!stroke)
      return {
        ...paint,
        seed: undefined,
        steps: undefined,
        decaySteps: undefined,
        brushActive: false,
      };
    const d = Math.max(1, steps - 1),
      t = steps <= 1 ? 1 : step / d,
      pt = steps <= 1 ? t : Math.max(0, step - 1) / d;
    const brushCell = [
        mix(stroke.fromCell[0], stroke.toCell[0], t),
        mix(stroke.fromCell[1], stroke.toCell[1], t),
      ] as const,
      prev = [
        mix(stroke.fromCell[0], stroke.toCell[0], pt),
        mix(stroke.fromCell[1], stroke.toCell[1], pt),
      ] as const;
    return {
      ...paint,
      seed: undefined,
      steps: undefined,
      stroke: undefined,
      decaySteps: undefined,
      brushCell,
      brushPreviousCell: prev,
      brushActive:
        stroke.movementGated === false ||
        Math.hypot(brushCell[0] - prev[0], brushCell[1] - prev[1]) >=
          PAINT_STROKE_MOVEMENT_EPSILON_CELLS,
      dt:
        stroke.duration !== undefined && steps > 0
          ? stroke.duration / steps
          : paint.dt,
    };
  };
  const decay = (
    f: Frame,
    t: PaintTargets,
    p: PaintRenderOptions = {},
    decayEffect: Effect = r.pipelines.paintDecay,
  ) => {
    const brush = p.brushCell ?? [-1e6, -1e6],
      prev = p.brushPreviousCell ?? brush;
    decayEffect.set({
      readTex: t.paint.read.color,
      staticNoiseTex: t.staticNoise.color,
      params: {
        brushCell: brush,
        brushPreviousCell: prev,
        brushRadius: p.brushRadius ?? DEFAULT_PAINT_BRUSH_RADIUS,
        brushStrength: p.brushStrength ?? DEFAULT_PAINT_BRUSH_STRENGTH,
        decayRate: p.decayRate ?? DEFAULT_PAINT_DECAY_RATE,
        diffusionRate: p.diffusionRate ?? DEFAULT_PAINT_DIFFUSION_RATE,
        diffusionJitter: p.diffusionJitter ?? DEFAULT_PAINT_DIFFUSION_JITTER,
        dt: Math.min(Math.max(p.dt ?? DEFAULT_PAINT_DT, 0), 0.1),
        brushActive: p.brushActive ? 1 : 0,
        _pad: 0,
        rippleCenter: p.ripple?.center ?? [-1e6, -1e6],
        rippleAge: p.ripple?.age ?? Number.POSITIVE_INFINITY,
        rippleStrength: p.ripple?.strength ?? 0,
      },
    });
    f.pass(t.paint.write, decayEffect);
    t.paint.swap();
  };
  const apply = (f: Frame, t: PaintTargets, p?: PaintRenderOptions) => {
    if (p?.seed) uploadSeed(t, p.seed);
    if (p?.seed || p?.stroke) {
      const n = Math.max(0, Math.floor(p.steps ?? 0));
      for (let i = 0; i < n; i++) {
        decay(f, t, stepOptions(p, i, n), effectForStep(i));
      }
      const decaySteps = Math.max(0, Math.floor(p.decaySteps ?? 0));
      for (let i = 0; i < decaySteps; i++) {
        decay(
          f,
          t,
          {
            ...p,
            seed: undefined,
            steps: undefined,
            stroke: undefined,
            decaySteps: undefined,
            brushActive: false,
          },
          effectForStep(n + i),
        );
      }
    } else decay(f, t, p);
  };
  const renderVoronoiNoise = (
    f: Frame,
    t: PaintTargets,
    c: RenderControls,
    w: number,
    h: number,
    pad: number,
    im: ImprintRenderOptions = {},
  ) => {
    const m = paintMappingMetrics(
      mesh.bounds,
      c,
      w,
      h,
      im.gridScaleMultiplier ?? DEFAULT_IMPRINT_GRID_SCALE_MULTIPLIER,
      pad,
      im.devicePixelRatio,
    );
    r.pipelines.voronoiNoise.set({
      params: {
        gridScale: m.gridScale,
        time: im.time ?? 0,
        originCell: m.originCell,
      },
    });
    f.pass(t.voronoi, r.pipelines.voronoiNoise);
  };
  const renderDebug = (
    f: Frame,
    target: import("vgpu").Target,
    t: PaintTargets,
  ) => {
    r.pipelines.paintDebug.set({ paintTex: t.paint.read.color });
    f.pass(target, r.pipelines.paintDebug);
  };
  return { ensure, apply, renderVoronoiNoise, renderDebug, dispose };
}
