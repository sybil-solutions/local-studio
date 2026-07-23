import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

const packageDir = path.resolve(import.meta.dirname, "..");
const bundlePath = path.join(packageDir, "dist", "standalone.mjs");
const runtimePackages = ["playwright-core", "chromium-bidi", "mitt", "devtools-protocol"];

test(
  "packages Playwright without build-machine paths",
  () => {
    execFileSync("npm", ["run", "bundle"], { cwd: packageDir, stdio: "pipe" });

    const bundle = readFileSync(bundlePath, "utf8");
    for (const packageName of runtimePackages) {
      const source = realpathSync(
        path.join(packageDir, "node_modules", ...packageName.split("/")),
      );
      expect(bundle).not.toContain(source);
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
          'console.log(JSON.stringify({ name: playwright.chromium.name(), path: require.resolve("playwright-core/package.json") }));',
        ].join("\n"),
      ],
      { encoding: "utf8" },
    );
    const playwright = JSON.parse(resolved) as { name: string; path: string };
    expect(playwright.name).toBe("chromium");
    expect(playwright.path).toStartWith(path.join(packageDir, "dist", "node_modules"));
  },
  30_000,
);
