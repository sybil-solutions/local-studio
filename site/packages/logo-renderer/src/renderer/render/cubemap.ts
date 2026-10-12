// Studio cubemap allocation and one-time bake through public vgpu effects/frames.
// vgpu has no public array-layer target factory. faceTarget is the isolated adapter that lets
// frame.pass address one layer while the rest of the renderer stays on the public frame API.
import { effect, frame, sampler, type Gpu, type Target } from "vgpu";
import { createResourceIdentity, type Texture } from "vgpu/core";
import eveCubemap from "../shaders/cubemap/render.wgsl";
import {
  CUBE_FACE_COUNT,
  CUBE_FORMAT,
  CUBE_MAX_LIGHTS,
  CUBE_SIZE,
} from "./constants";
import type { EnvLightConfig, StudioCubemap, Vec3 } from "./types";

export function createStudioCubemap(
  gpu: Gpu,
  label = "eve-5-studio-hdr-cubemap",
): StudioCubemap {
  const texture = gpu.device.createTexture({
    label,
    size: [CUBE_SIZE, CUBE_SIZE, CUBE_FACE_COUNT],
    dimension: "2d",
    format: CUBE_FORMAT,
    usage: ["copy_dst", "render_attachment", "texture_binding"],
  });
  return {
    texture,
    view: texture.createView({
      dimension: "2d-array",
      baseArrayLayer: 0,
      arrayLayerCount: CUBE_FACE_COUNT,
    }),
    sampler: sampler(gpu, { magFilter: "linear", minFilter: "linear" }),
  };
}

export type StudioCubemapAtlas =
  | ImageBitmap
  // Node snapshot builds pass pre-converted rgba16float linear pixels.
  | {
      readonly width: number;
      readonly atlasHeight: number;
      readonly facesRGBA16Linear: Uint16Array;
    };

export function uploadStudioCubemapAtlas(
  gpu: Gpu,
  cubemap: StudioCubemap,
  atlas: StudioCubemapAtlas,
) {
  if ("facesRGBA16Linear" in atlas) {
    if (atlas.width < CUBE_SIZE || atlas.atlasHeight < CUBE_SIZE * CUBE_FACE_COUNT)
      throw new Error("Cloud cubemap atlas dimensions do not match the renderer");
    if (atlas.facesRGBA16Linear.length !== atlas.width * atlas.atlasHeight * 4)
      throw new Error("Studio cubemap atlas pixel data does not match its dimensions");
    const faceHeight = atlas.atlasHeight / CUBE_FACE_COUNT;
    const facePixels = atlas.width * faceHeight * 4;
    for (let face = 0; face < CUBE_FACE_COUNT; face++) {
      gpu.gpu.queue.writeTexture(
        { texture: cubemap.texture.gpu, origin: { x: 0, y: 0, z: face } },
        atlas.facesRGBA16Linear.subarray(face * facePixels, (face + 1) * facePixels),
        { bytesPerRow: atlas.width * 8, rowsPerImage: faceHeight },
        { width: atlas.width, height: faceHeight, depthOrArrayLayers: 1 },
      );
    }
    return;
  }
  if (atlas.width < CUBE_SIZE || atlas.height < CUBE_SIZE * CUBE_FACE_COUNT)
    throw new Error("Cloud cubemap atlas dimensions do not match the renderer");
  for (let face = 0; face < CUBE_FACE_COUNT; face++)
    gpu.gpu.queue.copyExternalImageToTexture(
      { source: atlas, origin: { x: 0, y: face * CUBE_SIZE } },
      {
        texture: cubemap.texture.gpu,
        origin: { x: 0, y: 0, z: face },
        colorSpace: "srgb",
      },
      { width: CUBE_SIZE, height: CUBE_SIZE },
    );
}

function faceTarget(texture: Texture, face: number): Target {
  const view = texture.createView({
    dimension: "2d",
    baseArrayLayer: face,
    arrayLayerCount: 1,
  });
  return {
    gpu: texture.gpu,
    size: [CUBE_SIZE, CUBE_SIZE],
    texelSize: [1 / CUBE_SIZE, 1 / CUBE_SIZE],
    color: texture,
    colors: [texture],
    depth: undefined,
    format: CUBE_FORMAT,
    sampleCount: 1,
    clearColor: [0, 0, 0, 1],
    resourceIdentity: createResourceIdentity("render-target"),
    resize() {
      throw new Error("Cubemap face targets are fixed-size");
    },
    read() {
      return texture.read();
    },
    readFloats() {
      return texture.readFloats();
    },
    onDestroy() {
      return () => {};
    },
    renderPassDescriptor(opts = {}) {
      const clear = opts.clear ?? [0, 0, 0, 1];
      const clearValue =
        "length" in clear
          ? { r: clear[0], g: clear[1], b: clear[2], a: clear[3] }
          : clear;
      const attachment: GPURenderPassColorAttachment = {
        view,
        loadOp: opts.preserve ? "load" : "clear",
        storeOp: "store",
      };
      if (!opts.preserve) attachment.clearValue = clearValue;
      return { colorAttachments: [attachment] };
    },
  };
}

export function renderStudioCubemap(
  gpu: Gpu,
  cubemap: StudioCubemap,
  lights: readonly EnvLightConfig[],
  globalIntensity = 1,
) {
  const bakes = Array.from({ length: CUBE_FACE_COUNT }, (_, face) =>
    effect(gpu, eveCubemap, {
      label: `eve-5-studio-cubemap-bake-${face}`,
      set: { params: cubeParams(face, lights, globalIntensity) },
    }),
  );
  frame(gpu, (current) => {
    for (let face = 0; face < CUBE_FACE_COUNT; face++)
      current.pass(faceTarget(cubemap.texture, face), bakes[face]!);
  });
}
function cubeParams(
  face: number,
  lights: readonly EnvLightConfig[],
  globalIntensity: number,
) {
  if (lights.length > CUBE_MAX_LIGHTS)
    throw new Error(
      `Studio cubemap supports up to ${CUBE_MAX_LIGHTS} lights, received ${lights.length}`,
    );
  const packed = Array.from({ length: CUBE_MAX_LIGHTS }, (_, i) => {
    const light = lights[i];
    if (!light)
      return {
        positionRadius: [0, 0, 0, 0],
        colorIntensity: [0, 0, 0, 0],
        params: [0, 0, 0, 0],
      };
    const [r, g, b] = lightColorLinear(light);
    return {
      positionRadius: [...light.position, light.radius],
      colorIntensity: [r, g, b, light.intensity * globalIntensity],
      params: [light.softness, light.luminance, 0, 0],
    };
  });
  return {
    face,
    lightCount: lights.length,
    _pad0: 0,
    _pad1: 0,
    lights: packed,
  };
}
export function cubeParamsData(
  face: number,
  lights: readonly EnvLightConfig[],
  globalIntensity: number,
) {
  const data = new Float32Array(4 + CUBE_MAX_LIGHTS * 12);
  data[0] = face;
  data[1] = lights.length;
  lights.forEach((light, index) => {
    const [r, g, b] = lightColorLinear(light),
      o = 4 + index * 12;
    data.set(
      [
        ...light.position,
        light.radius,
        r,
        g,
        b,
        light.intensity * globalIntensity,
        light.softness,
        light.luminance,
      ],
      o,
    );
  });
  return data;
}
export function lightColorLinear(light: EnvLightConfig): Vec3 {
  return srgbHexToLinear(light.color);
}
export function srgbHexToLinear(hex: string): Vec3 {
  const n = hex.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(n))
    throw new Error(`Expected a 6-digit sRGB hex color, received ${hex}`);
  const c = (o: number) => {
    const x = Number.parseInt(n.slice(o, o + 2), 16) / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return [c(0), c(2), c(4)];
}
