import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyReleaseVersion, isValidReleaseVersion } from "./apply-release-version.mjs";

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-studio-release-version-"));

  await writeJson(path.join(root, "package.json"), {
    name: "local-studio",
    version: "2.0.0",
    private: true,
  });
  await writeJson(path.join(root, "package-lock.json"), {
    name: "local-studio",
    version: "2.0.0",
    lockfileVersion: 3,
    packages: {
      "": {
        name: "local-studio",
        version: "2.0.0",
      },
    },
  });
  await writeJson(path.join(root, "frontend", "package.json"), {
    name: "frontend",
    version: "2.0.0",
    private: true,
  });
  await writeJson(path.join(root, "frontend", "package-lock.json"), {
    name: "frontend",
    version: "2.0.0",
    lockfileVersion: 3,
    packages: {
      "": {
        name: "frontend",
        version: "2.0.0",
      },
    },
  });

  return root;
}

test("validates semantic-release version strings without tag prefixes", () => {
  assert.equal(isValidReleaseVersion("2.0.1"), true);
  assert.equal(isValidReleaseVersion("2.0.1-beta.1"), true);
  assert.equal(isValidReleaseVersion("v2.0.1"), false);
  assert.equal(isValidReleaseVersion("2.0"), false);
  assert.equal(isValidReleaseVersion("latest"), false);
});

test("applies the release version to root and frontend package metadata", async () => {
  const root = await createFixture();

  await applyReleaseVersion({ rootDir: root, version: "2.0.1" });

  assert.equal((await readJson(path.join(root, "package.json"))).version, "2.0.1");
  assert.equal((await readJson(path.join(root, "package-lock.json"))).version, "2.0.1");
  assert.equal(
    (await readJson(path.join(root, "package-lock.json"))).packages[""].version,
    "2.0.1",
  );
  assert.equal((await readJson(path.join(root, "frontend", "package.json"))).version, "2.0.1");
  assert.equal(
    (await readJson(path.join(root, "frontend", "package-lock.json"))).version,
    "2.0.1",
  );
  assert.equal(
    (await readJson(path.join(root, "frontend", "package-lock.json"))).packages[""].version,
    "2.0.1",
  );
});
