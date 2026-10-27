import type { Frame, Target } from "vgpu";
import type { RendererResources } from "../resources";
import type { BloomTargets } from "../types";
export function renderLightComposite(
  f: Frame,
  r: RendererResources,
  target: Target,
  t: BloomTargets,
) {
  r.pipelines.lightComposite.set({
    sceneTexture: t.scene.color,
    texSampler: r.sampler,
  });
  f.pass({ target, clear: [0, 0, 0, 0] }, r.pipelines.lightComposite);
}
