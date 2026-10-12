import type { Frame, Target } from "vgpu";
import type { Texture } from "vgpu/core";
import { PASS_OUTSIDE, PASS_WIREFRAME } from "../constants";
import { writeParams } from "../params";
import type { RendererResources } from "../resources";
import type { ImprintRenderOptions, MeshData, RenderControls } from "../types";
export function renderScene(
  f: Frame,
  r: RendererResources,
  m: MeshData,
  target: Target,
  backMaterial: Texture,
  backDepth: Texture,
  paint: Texture,
  voronoiValue: Texture,
  voronoiEdge: Texture,
  c: RenderControls,
  w: number,
  h: number,
  pad = r.paddingRadius,
  im: ImprintRenderOptions = {},
) {
  const base = {
    controls: c,
    logicalWidth: w,
    logicalHeight: h,
    projectionPaddingRadius: pad,
    meshBounds: m.bounds,
    orbitTarget: r.orbitTarget,
    thicknessScale: r.thicknessScale,
    isLight: r.isLight,
  };
  const bindings = {
    studioCube: r.studioCubemap.view,
    studioSampler: r.studioCubemap.sampler,
    backMaterial,
    backDepth,
    paintTex: paint,
    asciiVoronoiValueTex: voronoiValue,
    asciiVoronoiEdgeTex: voronoiEdge,
  };
  if (c.showEnv)
    r.pipelines.envBg.set({
      params: writeParams({ ...base, passKind: PASS_OUTSIDE }),
      studioCube: r.studioCubemap.view,
      studioSampler: r.studioCubemap.sampler,
    });
  if (c.material === "glass" || c.material === "thickness")
    r.pipelines.frontMaterial.set({
      ...bindings,
      params: writeParams({ ...base, passKind: PASS_OUTSIDE, imprint: im }),
    });
  else
    r.pipelines.opaque.set({
      ...bindings,
      params: writeParams({ ...base, passKind: PASS_OUTSIDE }),
    });
  if (c.wireframe)
    r.pipelines.wire.set({
      ...bindings,
      params: writeParams({ ...base, passKind: PASS_WIREFRAME }),
    });
  f.pass(target, (pass) => {
    if (c.showEnv) pass.draw(r.pipelines.envBg);
    if (c.outsideRendering)
      pass.draw(
        c.material === "glass" || c.material === "thickness"
          ? r.pipelines.frontMaterial
          : r.pipelines.opaque,
      );
    if (c.wireframe) pass.draw(r.pipelines.wire);
  });
}
