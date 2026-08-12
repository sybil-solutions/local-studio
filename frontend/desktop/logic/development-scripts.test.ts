import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

type Manifest = { scripts: Record<string, string> };

const readManifest = (path: string): Manifest => JSON.parse(readFileSync(path, "utf8")) as Manifest;

describe("development scripts", () => {
  test("passes controller scripts after Bun's Windows cwd option", () => {
    const manifest = readManifest(resolve(process.cwd(), "..", "package.json"));

    expect(manifest.scripts["dev:controller"]).toBe("bun run --cwd controller dev");
    expect(manifest.scripts["start:controller"]).toBe("bun run --cwd controller start");
    expect(manifest.scripts["desktop:dev"]).toContain('"npm run dev:controller"');
    expect(manifest.scripts["desktop:dev"]).toContain('"npm --prefix frontend run desktop:dev"');
  });

  test("starts Electron without an inline shell expression", () => {
    const manifest = readManifest(resolve(process.cwd(), "package.json"));
    const script = manifest.scripts["desktop:dev"];

    expect(script).toContain('"npm run desktop:start:dev"');
    expect(script).not.toContain("node -e");
  });
});
