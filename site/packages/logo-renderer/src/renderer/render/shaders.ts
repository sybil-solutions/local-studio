// Central shader-source registry for public vgpu draw/effect creation.
import glassBack from "../shaders/glass/back.wgsl";
import glassFront from "../shaders/glass/front.wgsl";
import glassBackDepth from "../shaders/glass/back-depth.wgsl";
import bloomBlur from "../shaders/bloom/blur.wgsl";
import bloomComposite from "../shaders/bloom/composite.wgsl";
import lightComposite from "../shaders/postprocess/light-composite.wgsl";
import envBg from "../shaders/env/background.wgsl";
import preview from "../shaders/debug/render-target-preview.wgsl";
import paintUpdate from "../shaders/paint/paint-update.wgsl";
import paintDebug from "../shaders/paint/paint-debug.wgsl";
import voronoiNoiseUpdate from "../shaders/paint/voronoi-noise-update.wgsl";

export const shaders = {
  glassBack,
  glassFront,
  glassBackDepth,
  bloomBlur,
  bloomComposite,
  lightComposite,
  envBg,
  preview,
  paintUpdate,
  paintDebug,
  voronoiNoiseUpdate,
};
