// Node module hooks for running the TypeScript renderer headless.
// Registered via --import; enables two things the browser bundler provides:
// 1. extensionless relative imports resolve to .ts (type-stripped on load)
// 2. .wgsl imports export their fully resolved WGSL string
// The wgsl sources are pre-resolved before registration so every hook stays
// synchronous: an async load hook breaks CJS modules in the graph
// (their load result has no source, which async validation rejects).
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks, createRequire } from "node:module";

const requireFromVgpu = createRequire(import.meta.resolve("vgpu/package.json"));
const { resolveShader } = requireFromVgpu("@vgpu/wgsl/runtime");

const shadersRoot = new URL("../src/renderer/shaders/", import.meta.url);
const wgslSources = new Map();
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (entry.name.endsWith(".wgsl"))
      wgslSources.set(pathToFileURL(path).href, null);
  }
}
collect(fileURLToPath(shadersRoot));
for (const url of wgslSources.keys()) {
  const resolved = await resolveShader({ entry: fileURLToPath(url) });
  wgslSources.set(url, `export default ${JSON.stringify(resolved.wgsl)};`);
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const hasExtension = /\.[a-z]+$/i.test(specifier);
      if (!hasExtension && (specifier.startsWith(".") || specifier.startsWith("/"))) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
  load(url, context, nextLoad) {
    const source = wgslSources.get(url);
    if (source !== undefined) {
      return { format: "module", shortCircuit: true, source };
    }
    return nextLoad(url, context);
  },
});
