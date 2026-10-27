// Public vgpu targets intentionally omit COPY_DST. Paint seeds need direct uploads, so this
// file isolates the small core-Texture-to-Target adapter instead of leaking it into the frame graph.
import type { Gpu, PingPongTargets, Target } from "vgpu";
import { createResourceIdentity } from "vgpu/core";
import { BLOOM_RADIUS } from "./constants";
export function getPaddedRenderSize(
  width: number,
  height: number,
  paddingRadius = BLOOM_RADIUS,
) {
  const padding = Math.max(0, Math.round(paddingRadius)) * 2;
  return {
    width: Math.max(1, Math.round(width)) + padding,
    height: Math.max(1, Math.round(height)) + padding,
  };
}
export function hashPaintCell(x: number, y: number, salt: number) {
  let h =
    (Math.imul(x >>> 0, 0x8da6b343) ^ Math.imul(y >>> 0, 0xd8163841) ^ salt) >>>
    0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h & 0x00ffffff) / 0x01000000;
}

export function createUploadTarget(
  gpu: Gpu,
  size: readonly [number, number],
  format: GPUTextureFormat,
  label: string,
): Target {
  const color = gpu.device.createTexture({
    size,
    format,
    label,
    usage: ["render_attachment", "texture_binding", "copy_dst", "copy_src"],
  });
  return {
    gpu: color.gpu,
    size,
    texelSize: [1 / size[0], 1 / size[1]],
    color,
    colors: [color],
    depth: undefined,
    format,
    sampleCount: 1,
    clearColor: [0, 0, 0, 1],
    resourceIdentity: createResourceIdentity("render-target"),
    resize() {
      throw new Error("Upload targets are recreated when their size changes");
    },
    read() {
      return color.read();
    },
    readFloats() {
      return color.readFloats();
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
        view: color.createView(),
        loadOp: opts.preserve ? "load" : "clear",
        storeOp: "store",
      };
      if (!opts.preserve) attachment.clearValue = clearValue;
      return { colorAttachments: [attachment] };
    },
  };
}
export function createUploadPingPong(
  gpu: Gpu,
  width: number,
  height: number,
  format: GPUTextureFormat,
  label: string,
): PingPongTargets {
  let read = createUploadTarget(gpu, [width, height], format, `${label}-ping`);
  let write = createUploadTarget(gpu, [width, height], format, `${label}-pong`);
  return {
    get read() {
      return read;
    },
    get write() {
      return write;
    },
    swap() {
      [read, write] = [write, read];
    },
  };
}
