import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stageDesktopRelease } from "./stage-desktop-release.mjs";

const version = "2.0.1";
const assetNames = [
  `Local Studio-${version}-arm64.dmg`,
  `Local Studio-${version}-arm64.dmg.blockmap`,
  `Local Studio-${version}-arm64-mac.zip`,
  `Local Studio-${version}-arm64-mac.zip.blockmap`,
  "latest-mac.yml",
];

async function createFixture(files = assetNames) {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-studio-stage-assets-"));
  const output = path.join(root, "frontend", "dist-desktop");
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(root, "frontend", "package.json"),
    `${JSON.stringify({ version }, null, 2)}\n`,
  );
  for (const file of files) await writeFile(path.join(output, file), file);
  return root;
}

test("stages exact updater names and stable download aliases", async () => {
  const root = await createFixture();
  const { files, staging } = stageDesktopRelease(root);

  assert.deepEqual(files, [
    `Local Studio-${version}-arm64-mac.zip`,
    `Local Studio-${version}-arm64-mac.zip.blockmap`,
    `Local Studio-${version}-arm64.dmg`,
    `Local Studio-${version}-arm64.dmg.blockmap`,
    "Local-Studio-arm64-mac.zip",
    "Local-Studio-arm64.dmg",
    "latest-mac.yml",
  ]);
  assert.equal(
    await readFile(path.join(staging, "Local-Studio-arm64.dmg"), "utf8"),
    `Local Studio-${version}-arm64.dmg`,
  );
  assert.equal(
    await readFile(path.join(staging, "Local-Studio-arm64-mac.zip"), "utf8"),
    `Local Studio-${version}-arm64-mac.zip`,
  );
});

test("fails before staging when a required updater asset is missing", async () => {
  const root = await createFixture(assetNames.filter((name) => name !== "latest-mac.yml"));
  assert.throws(() => stageDesktopRelease(root), /Missing desktop release asset: .*latest-mac\.yml/);
});
