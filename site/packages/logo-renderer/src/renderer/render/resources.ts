// Long-lived public vgpu resources for one Eve renderer instance.
import { sampler, target, type Gpu } from "vgpu";
import {
  BLOOM_RADIUS,
  PAINT_FORMAT,
  SCENE_FORMAT,
  VORONOI_NOISE_FORMAT,
} from "./constants";
import {
  type StudioCubemapAtlas,
  createStudioCubemap,
  renderStudioCubemap,
  uploadStudioCubemapAtlas,
} from "./cubemap";
import { EVE_DARK_ENV_LIGHTS, EVE_LIGHT_ENV_LIGHTS } from "./env-lights";
import { meshOrbitTarget, meshThicknessScale } from "./camera";
import { createGpuMesh } from "./mesh-gpu";
import { createPipelines } from "./pipelines";
import type { MeshData } from "./types";

export function createResources(
  gpu: Gpu,
  mesh: MeshData,
  options: {
    thicknessScale?: number;
    theme?: "light" | "dark";
    paddingRadius?: number;
    bloom?: boolean;
    environmentAtlas?: StudioCubemapAtlas;
  } = {},
) {
  const studioCubemap = createStudioCubemap(gpu);
  const isLight = options.theme === "light";
  if (options.environmentAtlas)
    uploadStudioCubemapAtlas(gpu, studioCubemap, options.environmentAtlas);
  else
    renderStudioCubemap(
      gpu,
      studioCubemap,
      isLight ? EVE_LIGHT_ENV_LIGHTS : EVE_DARK_ENV_LIGHTS,
    );
  const gpuMesh = createGpuMesh(gpu, mesh);
  const pipelines = createPipelines(gpu, gpuMesh);
  const fallbackBackMaterial = target(gpu, {
    size: [1, 1],
    format: SCENE_FORMAT,
    label: "eve-5-empty-back-material",
  });
  const fallbackBackDepth = target(gpu, {
    size: [1, 1],
    format: SCENE_FORMAT,
    label: "eve-5-empty-back-depth",
  });
  const fallbackPaint = target(gpu, {
    size: [1, 1],
    format: PAINT_FORMAT,
    label: "eve-5-empty-paint",
  });
  const fallbackVoronoiValue = target(gpu, {
    size: [1, 1],
    format: VORONOI_NOISE_FORMAT,
    label: "eve-5-empty-voronoi-value",
  });
  const fallbackVoronoiEdge = target(gpu, {
    size: [1, 1],
    format: VORONOI_NOISE_FORMAT,
    label: "eve-5-empty-voronoi-edge",
  });
  return {
    studioCubemap,
    isLight,
    orbitTarget: meshOrbitTarget(mesh),
    thicknessScale: options.thicknessScale ?? meshThicknessScale(mesh.bounds),
    paddingRadius: options.paddingRadius ?? BLOOM_RADIUS,
    bloomEnabled: options.bloom ?? true,
    pipelines,
    gpuMesh,
    sampler: sampler(gpu, {
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    }),
    fallbacks: {
      fallbackBackMaterial,
      fallbackBackDepth,
      fallbackPaint,
      fallbackVoronoiValue,
      fallbackVoronoiEdge,
    },
  };
}
export type RendererResources = ReturnType<typeof createResources>;
export function disposeResources(r: RendererResources) {
  r.gpuMesh.lines.destroy();
  r.gpuMesh.triangles.destroy();
  r.studioCubemap.texture.destroy();
  for (const t of Object.values(r.fallbacks)) {
    t.color.destroy();
    t.depth?.destroy();
  }
}
