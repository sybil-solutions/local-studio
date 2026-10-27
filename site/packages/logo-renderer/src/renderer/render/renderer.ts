// Eve renderer frame graph on the public vgpu API.
import { frame, type Gpu, type Target } from "vgpu";
import {
  BLOOM_STRENGTH_OFF,
  BLOOM_STRENGTH_ON,
  bloomRadiusForDevicePixelRatio,
} from "./constants";
import type { StudioCubemapAtlas } from "./cubemap";
import { clampUnit, mix } from "./math";
import { createPaintSystem } from "./paint-system";
import { renderBackDepth, renderBackMaterial } from "./passes/back-pass";
import { renderBlur, renderComposite } from "./passes/bloom-pass";
import {
  renderTargetPreview,
  renderThicknessDebug,
} from "./passes/debug-passes";
import { renderLightComposite } from "./passes/light-composite-pass";
import { renderScene } from "./passes/scene-pass";
import { createResources, disposeResources } from "./resources";
import { createBloomTargetCache } from "./targets";
import type { ImprintRenderOptions, MeshData, RenderControls } from "./types";
export function createEve5Renderer(
  gpu: Gpu,
  mesh: MeshData,
  options: {
    thicknessScale?: number;
    theme?: "light" | "dark";
    paddingRadius?: number;
    bloom?: boolean;
    backRefraction?: boolean;
    environmentAtlas?: StudioCubemapAtlas;
  } = {},
) {
  const r = createResources(gpu, mesh, options),
    backRefraction = options.backRefraction ?? true,
    cache = createBloomTargetCache(gpu),
    paint = createPaintSystem(gpu, r, mesh);
  const renderGlass = (
    out: Target,
    c: RenderControls,
    lw: number,
    lh: number,
    im: ImprintRenderOptions = {},
  ) => {
    const w = Math.max(1, Math.round(lw)),
      h = Math.max(1, Math.round(lh)),
      pad =
        options.paddingRadius ??
        bloomRadiusForDevicePixelRatio(im.devicePixelRatio),
      needs =
        (backRefraction && c.material === "glass") ||
        c.material === "back-albedo" ||
        c.material === "back-depth" ||
        c.material === "thickness",
      t = cache.ensure(w, h, pad, needs),
      pt = paint.ensure(w, h, im.gridScaleMultiplier);
    frame(gpu, (f) => {
      if (needs && t.backMaterial && t.backDepth) {
        renderBackMaterial(f, r, mesh, t.backMaterial, c, w, h, pad);
        renderBackDepth(f, r, mesh, t.backDepth, c, w, h, pad);
      }
      paint.apply(f, pt, im.paint);
      if (
        (c.material === "back-albedo" || c.material === "back-depth") &&
        t.backMaterial &&
        t.backDepth
      ) {
        renderTargetPreview(
          f,
          r,
          mesh,
          out,
          t.backMaterial.color,
          t.backDepth.color,
          c,
        );
        return;
      }
      if (c.material === "thickness" && t.backMaterial && t.backDepth) {
        renderThicknessDebug(
          f,
          r,
          mesh,
          out,
          t.backMaterial.color,
          t.backDepth.color,
          pt.paint.read.color,
          c,
          w,
          h,
          pad,
        );
        return;
      }
      if (c.material === "paint-debug") {
        paint.renderDebug(f, out, pt);
        return;
      }
      paint.renderVoronoiNoise(f, pt, c, w, h, pad, im);
      renderScene(
        f,
        r,
        mesh,
        t.scene,
        backRefraction && t.backMaterial
          ? t.backMaterial.color
          : r.fallbacks.fallbackBackMaterial.color,
        backRefraction && t.backDepth
          ? t.backDepth.color
          : r.fallbacks.fallbackBackDepth.color,
        pt.paint.read.color,
        pt.voronoi.colors[0],
        pt.voronoi.colors[1]!,
        c,
        w,
        h,
        pad,
        im,
      );
      if (r.isLight) {
        renderLightComposite(f, r, out, t);
        return;
      }
      if (!r.bloomEnabled) {
        renderComposite(f, r, out, t, t.scene.color, 0);
        return;
      }
      const strength = mix(
        BLOOM_STRENGTH_OFF,
        BLOOM_STRENGTH_ON,
        clampUnit(im.progress ?? 0),
      );
      renderBlur(f, r, t.scene.color, t.bloom.write, [1, 0], true, pad);
      t.bloom.swap();
      renderBlur(
        f,
        r,
        t.bloom.read.color,
        t.bloom.write,
        [0, 1],
        false,
        Math.max(0, Math.round(pad / 2)),
      );
      t.bloom.swap();
      renderComposite(f, r, out, t, t.bloom.read.color, strength);
    });
  };
  return {
    render(
      target: Target,
      controls: RenderControls,
      logicalWidth: number,
      logicalHeight: number,
      imprint?: ImprintRenderOptions,
    ) {
      renderGlass(target, controls, logicalWidth, logicalHeight, imprint);
    },
    dispose() {
      paint.dispose();
      cache.dispose();
      disposeResources(r);
    },
  };
}
