// Renders the hero's first frame offline into committed PNG snapshots.
// Output: public/localai/hero-render-{night,day}.png — the static image the hero
// shows instantly on load while the WebGPU canvas warms up (no black screen).
// Run from the repo root: pnpm -C packages/logo-renderer snapshot
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const requireFromVgpu = createRequire(import.meta.resolve("vgpu/package.json"));
const { PNG } = requireFromVgpu("pngjs");
const here = (path) => new URL(`./${path}`, import.meta.url);
const repo = (path) => new URL(`../../../${path}`, import.meta.url);

const LOGO_VIEWPORT_ASPECT = 1.52;
const SNAPSHOT_WIDTH = 1880;
const SNAPSHOT_HEIGHT = Math.round(SNAPSHOT_WIDTH / LOGO_VIEWPORT_ASPECT);

const { init, target } = await import("vgpu/node");
const { decodeGltfMesh } = await import(here("../src/renderer/mesh.ts").href);
const {
  DEFAULT_CAMERA_FOV,
  DEFAULT_OBJECT_YAW,
  DEFAULT_IMPRINT_GRID_SCALE_MULTIPLIER,
  cameraRadiusForBounds,
  createEve5Renderer,
} = await import(here("../src/renderer/render.ts").href);

// --- helpers -------------------------------------------------------------

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function float16(value) {
  // Encodes a finite float into its IEEE 754 half-precision bit pattern.
  const f32 = new Float32Array([value]);
  const u32 = new Uint32Array(f32.buffer)[0];
  const sign = (u32 >>> 31) & 1;
  const exponent = (u32 >>> 23) & 0xff;
  const mantissa = u32 & 0x7fffff;
  if (exponent === 0) return (sign << 15) | (mantissa >>> 13);
  if (exponent === 0xff) return (sign << 15) | 0x7c00 | (mantissa ? 1 : 0);
  const halfExponent = exponent - 127 + 15;
  if (halfExponent >= 0x1f) return (sign << 15) | 0x7c00;
  if (halfExponent <= 0) return sign << 15;
  return (sign << 15) | (halfExponent << 10) | (mantissa >>> 13);
}

function atlasRGBA16(png) {
  // sRGB 8-bit atlas -> rgba16float linear pixels, face-major.
  const { width, height, data } = png;
  const out = new Uint16Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = float16(srgbToLinear(data[i * 4]));
    out[i * 4 + 1] = float16(srgbToLinear(data[i * 4 + 1]));
    out[i * 4 + 2] = float16(srgbToLinear(data[i * 4 + 2]));
    out[i * 4 + 3] = float16(data[i * 4 + 3] / 255);
  }
  return { width, atlasHeight: height, facesRGBA16Linear: out };
}

function bufferOf(nodeBuffer) {
  return nodeBuffer.buffer.slice(
    nodeBuffer.byteOffset,
    nodeBuffer.byteOffset + nodeBuffer.byteLength,
  );
}

function loadMesh() {
  const gltfUrl = repo("public/localai/localai-logo.gltf");
  const gltf = JSON.parse(readFileSync(gltfUrl, "utf8"));
  return decodeGltfMesh(gltf, (uri) =>
    bufferOf(readFileSync(new URL(uri, gltfUrl))),
  );
}

// --- render ----------------------------------------------------------------

const mesh = await loadMesh();
const gpu = await init();
const radius = cameraRadiusForBounds(DEFAULT_CAMERA_FOV, mesh.bounds, LOGO_VIEWPORT_ASPECT);
const controls = {
  yaw: DEFAULT_OBJECT_YAW,
  pitch: 0,
  radius,
  fov: DEFAULT_CAMERA_FOV,
  envYaw: 0,
  envPitch: 0,
  insideRendering: true,
  outsideRendering: true,
  material: "glass",
  wireframe: false,
  showEnv: false,
};

for (const scheme of ["night", "day"]) {
  const atlasPng = PNG.sync.read(
    readFileSync(here(`assets/${scheme}-sky-cubemap.png`)),
  );
  const renderer = createEve5Renderer(gpu, mesh, {
    theme: "dark",
    bloom: true,
    backRefraction: true,
    environmentAtlas: atlasRGBA16(atlasPng),
  });
  // Render at the logical stage size: the composite squeezes the padded scene
  // into this target by the same factor the live canvas shrinks its padded
  // bitmap into the CSS box, so the poster matches the live frame exactly.
  const out = target(gpu, {
    size: [SNAPSHOT_WIDTH, SNAPSHOT_HEIGHT],
    format: "rgba8unorm",
    label: `hero-snapshot-${scheme}`,
  });
  renderer.render(out, controls, SNAPSHOT_WIDTH, SNAPSHOT_HEIGHT, {
    progress: 0,
    gridScaleMultiplier: DEFAULT_IMPRINT_GRID_SCALE_MULTIPLIER,
    glyphScale: 1.27,
    time: 0,
    mouse: [0, 0],
    devicePixelRatio: 2,
  });
  const premultiplied = await out.read();
  // Un-premultiply: the canvas composites premultiplied, PNG wants straight alpha.
  const png = new PNG({ width: SNAPSHOT_WIDTH, height: SNAPSHOT_HEIGHT });
  for (let i = 0; i < SNAPSHOT_WIDTH * SNAPSHOT_HEIGHT; i++) {
    const a = premultiplied[i * 4 + 3];
    for (let c = 0; c < 3; c++) {
      const v = premultiplied[i * 4 + c];
      png.data[i * 4 + c] = a === 0 ? 0 : Math.min(255, Math.round((v * 255) / a));
    }
    png.data[i * 4 + 3] = a;
  }
  const destination = repo(`public/localai/hero-render-${scheme}.png`);
  writeFileSync(destination, PNG.sync.write(png));
  console.log(`wrote ${fileURLToPath(destination).split("/").slice(-2).join("/")}`);
  renderer.dispose();
  out.color.destroy();
  out.depth?.destroy();
}

gpu.dispose();
