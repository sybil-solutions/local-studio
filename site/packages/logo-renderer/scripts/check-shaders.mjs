import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const shaderRoot = new URL("../src/renderer/shaders/", import.meta.url);
const vgpuBin = fileURLToPath(new URL("../node_modules/vgpu/bin/vgpu.js", import.meta.url));

function collect(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(entry.parentPath, entry.name);
    if (entry.isDirectory()) return collect(path);
    return entry.isFile() && entry.name.endsWith(".wgsl") ? [path] : [];
  });
}

const shaders = collect(shaderRoot);
for (const shader of shaders) {
  const result = spawnSync(process.execPath, [vgpuBin, "check", shader], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
}
console.log(`Validated ${shaders.length} WGSL files with vgpu.`);
