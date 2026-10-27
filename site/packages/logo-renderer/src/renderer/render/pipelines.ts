// Public vgpu render units. Target formats and MSAA are compiled lazily per Target.
import { draw, effect, type Gpu } from "vgpu";
import { shaders } from "./shaders";
import type { GpuMesh } from "./types";

export function createPipelines(gpu: Gpu, mesh: GpuMesh) {
  return {
    backMaterial: draw(gpu, {
      label: "eve-5-glass-back-material",
      shader: shaders.glassBack,
      geometry: mesh.triangles,
      cull: "front",
      depth: { write: true, compare: "less" },
    }),
    backDepth: draw(gpu, {
      label: "eve-5-glass-back-depth",
      shader: shaders.glassBackDepth,
      geometry: mesh.triangles,
      cull: "front",
      depth: { write: true, compare: "less" },
    }),
    frontMaterial: draw(gpu, {
      label: "eve-5-glass-front-material",
      shader: shaders.glassFront,
      geometry: mesh.triangles,
      cull: "back",
      depth: { write: true, compare: "less" },
    }),
    opaque: draw(gpu, {
      label: "eve-5-opaque-material",
      shader: shaders.glassFront,
      geometry: mesh.triangles,
      cull: "back",
      depth: { write: true, compare: "less" },
    }),
    wire: draw(gpu, {
      label: "eve-5-wireframe",
      shader: shaders.glassFront,
      geometry: mesh.lines,
      blend: "alpha",
      depth: { write: false, compare: "less-equal" },
    }),
    envBg: draw(gpu, {
      label: "eve-5-env-bg",
      shader: shaders.envBg,
      vertices: 3,
      depth: false,
    }),
    blurHorizontal: effect(gpu, shaders.bloomBlur, {
      label: "eve-5-bloom-blur-horizontal",
    }),
    blurVertical: effect(gpu, shaders.bloomBlur, {
      label: "eve-5-bloom-blur-vertical",
    }),
    composite: effect(gpu, shaders.bloomComposite, {
      label: "eve-5-bloom-composite",
    }),
    lightComposite: effect(gpu, shaders.lightComposite, {
      label: "eve-5-light-composite",
    }),
    preview: effect(gpu, shaders.preview, {
      label: "eve-5-render-target-preview",
    }),
    paintDecay: effect(gpu, shaders.paintUpdate, {
      label: "eve-5-paint-decay",
    }),
    paintDebug: effect(gpu, shaders.paintDebug, { label: "eve-5-paint-debug" }),
    voronoiNoise: effect(gpu, shaders.voronoiNoiseUpdate, {
      label: "eve-5-voronoi-noise",
    }),
  };
}
