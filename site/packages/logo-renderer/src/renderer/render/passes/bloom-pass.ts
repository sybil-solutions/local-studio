import type { Frame, Target } from "vgpu";
import type { Texture } from "vgpu/core";
import { BLOOM_STRENGTH_OFF, BLOOM_THRESHOLD } from "../constants";
import type { RendererResources } from "../resources";
import type { BloomTargets } from "../types";
export function renderBlur(
  f: Frame,
  r: RendererResources,
  source: Texture,
  target: Target,
  direction: [number, number],
  extract: boolean,
  radius: number,
) {
  const k = Math.max(0, Math.round(radius));
  const blur =
    direction[0] > 0 ? r.pipelines.blurHorizontal : r.pipelines.blurVertical;
  blur.set({
    sourceTexture: source,
    sourceSampler: r.sampler,
    params: {
      direction,
      extract: extract ? 1 : 0,
      threshold: BLOOM_THRESHOLD,
      radius: k,
      sigma: Math.max(0.001, k / 3),
    },
  });
  f.pass(target, blur);
}
export function renderComposite(
  f: Frame,
  r: RendererResources,
  target: Target,
  targets: BloomTargets,
  bloom: Texture = targets.bloom.read.color,
  strength = BLOOM_STRENGTH_OFF,
) {
  r.pipelines.composite.set({
    sceneTexture: targets.scene.color,
    bloomTexture: bloom,
    texSampler: r.sampler,
    params: { strength, _pad0: 0, _pad1: 0, _pad2: 0 },
  });
  f.pass(target, r.pipelines.composite);
}
