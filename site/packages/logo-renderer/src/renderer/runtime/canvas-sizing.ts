import type { MutableRefObject } from "react";
import { DEFAULT_IMPRINT_DEVICE_PIXEL_RATIO, bloomRadiusForDevicePixelRatio } from "../render";

// Owns canvas and hero-logo sizing math for the browser renderer.
// INVARIANT: load-bearing DPR/back-target alignment; must match getPaddedRenderSize.
// Imported by index.tsx and runtime frame orchestration only.

export const DEFAULT_LOGO_ASPECT = 78 / 25;
const LOGO_RENDER_HEIGHT = 500;
const MAX_DEVICE_PIXEL_RATIO = DEFAULT_IMPRINT_DEVICE_PIXEL_RATIO;
// Backing-store budget. The hero canvas can be large (wide viewports, high
// DPR screens); every per-pixel cost (4x MSAA scene, back targets, bloom)
// scales with device pixels, so cap total pixels and trade a little sampling
// density for stable frame times instead.
const MAX_RENDER_PIXELS = 1_500_000;

export type CanvasLayout = {
  width: number;
  height: number;
};

export type CanvasLayoutRef = MutableRefObject<CanvasLayout>;
export type DevicePixelRatioRef = MutableRefObject<number>;

export function getLogicalRenderSize(aspect: number) {
  return {
    width: Math.max(1, Math.round(LOGO_RENDER_HEIGHT * aspect)),
    height: LOGO_RENDER_HEIGHT,
  };
}

export function getBrowserDevicePixelRatio(devicePixelRatio: number) {
  return Math.min(devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
}

// DPR clamped so cssWidth x cssHeight x dpr^2 stays within MAX_RENDER_PIXELS.
// Shared by canvas sizing and pointer->paint mapping so the bloom padding the
// brush math subtracts always matches the renderer's actual padding.
export function getEffectiveDevicePixelRatio(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
) {
  const capped = getBrowserDevicePixelRatio(devicePixelRatio);
  const cssPixels = Math.max(1, cssWidth) * Math.max(1, cssHeight);
  const budgetScale = Math.sqrt(MAX_RENDER_PIXELS / cssPixels);
  return Math.max(1, Math.min(capped, budgetScale));
}

export function resizeCanvas(
  canvas: HTMLCanvasElement | null,
  canvasLayoutRef: CanvasLayoutRef,
  devicePixelRatioRef: DevicePixelRatioRef,
) {
  const { width: cssWidth, height: cssHeight } = canvasLayoutRef.current;
  const dpr = getEffectiveDevicePixelRatio(cssWidth, cssHeight, devicePixelRatioRef.current);
  if (!canvas) return dpr;
  const width = Math.max(1, Math.floor(cssWidth * dpr));
  const height = Math.max(1, Math.floor(cssHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return dpr;
}

export function getCanvasLogicalSize(canvas: HTMLCanvasElement, devicePixelRatio: number) {
  // The renderer pads the logical scene size by a DPR-scaled bloom radius on each side before
  // allocating its offscreen back/depth targets. The canvas itself is that padded physical render
  // target, so subtract the same physical padding here. Passing CSS/logical logo dimensions would
  // make the front shader's @builtin(position) sample different pixels from the back-side targets.
  const bloomRadius = bloomRadiusForDevicePixelRatio(devicePixelRatio);
  return {
    logicalWidth: Math.max(1, canvas.width - bloomRadius * 2),
    logicalHeight: Math.max(1, canvas.height - bloomRadius * 2),
  };
}
