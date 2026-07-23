import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

const packageDir = path.resolve(import.meta.dirname, "..");
const bundlePath = path.join(packageDir, "dist", "standalone.mjs");
const runtimePackages = [
  "playwright-core",
  "chromium-bidi",
  "mitt",
  "devtools-protocol",
  "@silvia-odwyer/photon-node",
  "undici",
];

test(
  "packages external runtimes without build-machine paths",
  () => {
    execFileSync("npm", ["run", "bundle"], { cwd: packageDir, stdio: "pipe" });

    const bundle = readFileSync(bundlePath, "utf8");
    expect(bundle).not.toContain(realpathSync(path.join(packageDir, "..", "..")));
    for (const packageName of runtimePackages) {
      expect(
        existsSync(
          path.join(packageDir, "dist", "node_modules", ...packageName.split("/"), "package.json"),
        ),
      ).toBe(true);
    }

    const resolved = execFileSync(
      "node",
      [
        "--input-type=module",
        "--eval",
        [
          'import { createRequire } from "node:module";',
          `const require = createRequire(${JSON.stringify(bundlePath)});`,
          'const playwright = require("playwright-core");',
          'const photon = require("@silvia-odwyer/photon-node");',
          'const undici = require("undici");',
          'console.log(JSON.stringify({ name: playwright.chromium.name(), playwright: require.resolve("playwright-core/package.json"), photon: require.resolve("@silvia-odwyer/photon-node/package.json"), photonReady: typeof photon.open_image === "function", undici: require.resolve("undici/package.json"), undiciReady: typeof undici.fetch === "function" }));',
        ].join("\n"),
      ],
      { encoding: "utf8" },
    );
    const runtime = JSON.parse(resolved) as {
      name: string;
      playwright: string;
      photon: string;
      photonReady: boolean;
      undici: string;
      undiciReady: boolean;
    };
    expect(runtime.name).toBe("chromium");
    expect(runtime.photonReady).toBe(true);
    expect(runtime.undiciReady).toBe(true);
    expect(runtime.playwright).toStartWith(path.join(packageDir, "dist", "node_modules"));
    expect(runtime.photon).toStartWith(path.join(packageDir, "dist", "node_modules"));
    expect(runtime.undici).toStartWith(path.join(packageDir, "dist", "node_modules"));
  },
  30_000,
);
