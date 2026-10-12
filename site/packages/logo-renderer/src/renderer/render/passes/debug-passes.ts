import type { Frame, Target } from "vgpu";
import type { Texture } from "vgpu/core";
import { cameraAxisDepthRange } from "../camera";
import {
  PASS_OUTSIDE,
  PREVIEW_BACK_ALBEDO,
  PREVIEW_BACK_DEPTH,
} from "../constants";
import { cameraBasis, orbitEye } from "../math";
import { writeParams } from "../params";
import type { RendererResources } from "../resources";
import type { MeshData, RenderControls } from "../types";
export function renderTargetPreview(
  f: Frame,
  r: RendererResources,
  m: MeshData,
  target: Target,
  backMaterial: Texture,
  backDepth: Texture,
  c: RenderControls,
) {
  const basis = cameraBasis(
      orbitEye(r.orbitTarget, c.radius, c.yaw, c.pitch),
      r.orbitTarget,
    ),
    range = cameraAxisDepthRange(m.bounds, basis.forward);
  r.pipelines.preview.set({
    backAlbedo: backMaterial,
    backDepthMap: backDepth,
    sourceSampler: r.sampler,
    mode: [
      c.material === "back-depth" ? PREVIEW_BACK_DEPTH : PREVIEW_BACK_ALBEDO,
      range.min,
      range.max,
      0,
    ],
  });
  f.pass(target, r.pipelines.preview);
}
export function renderThicknessDebug(
  f: Frame,
  r: RendererResources,
  m: MeshData,
  target: Target,
  backMaterial: Texture,
  backDepth: Texture,
  paint: Texture,
  c: RenderControls,
  w: number,
  h: number,
  pad = r.paddingRadius,
) {
  if (!c.outsideRendering) {
    f.pass(target, () => {});
    return;
  }
  r.pipelines.frontMaterial.set({
    params: writeParams({
      controls: c,
      logicalWidth: w,
      logicalHeight: h,
      passKind: PASS_OUTSIDE,
      projectionPaddingRadius: pad,
      meshBounds: m.bounds,
      orbitTarget: r.orbitTarget,
      thicknessScale: r.thicknessScale,
      isLight: r.isLight,
    }),
    studioCube: r.studioCubemap.view,
    studioSampler: r.studioCubemap.sampler,
    backMaterial,
    backDepth,
    paintTex: paint,
    asciiVoronoiValueTex: r.fallbacks.fallbackVoronoiValue.color,
    asciiVoronoiEdgeTex: r.fallbacks.fallbackVoronoiEdge.color,
  });
  f.pass(target, r.pipelines.frontMaterial);
}
