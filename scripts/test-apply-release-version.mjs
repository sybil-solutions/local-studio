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
  const root = await mkdtemp(path.join(os.tmpdir(), "vllm-studio-release-version-"));

  await writeJson(path.join(root, "package.json"), {
    name: "vllm-studio",
    version: "0.2.9",
    private: true,
  });
  await writeJson(path.join(root, "package-lock.json"), {
    name: "vllm-studio",
    version: "0.2.9",
    lockfileVersion: 3,
    packages: {
      "": {
        name: "vllm-studio",
        version: "0.2.9",
      },
    },
  });
  await writeJson(path.join(root, "frontend", "package.json"), {
    name: "frontend",
    version: "0.2.9",
    private: true,
  });
  await writeJson(path.join(root, "frontend", "package-lock.json"), {
    name: "frontend",
    version: "0.2.9",
    lockfileVersion: 3,
    packages: {
      "": {
        name: "frontend",
        version: "0.2.9",
      },
    },
  });

  return root;
}

test("validates semantic-release version strings without tag prefixes", () => {
  assert.equal(isValidReleaseVersion("1.49.1"), true);
  assert.equal(isValidReleaseVersion("1.49.1-beta.1"), true);
  assert.equal(isValidReleaseVersion("v1.49.1"), false);
  assert.equal(isValidReleaseVersion("1.49"), false);
  assert.equal(isValidReleaseVersion("latest"), false);
});

test("applies the release version to root and frontend package metadata", async () => {
  const root = await createFixture();

  await applyReleaseVersion({ rootDir: root, version: "1.49.1" });

  assert.equal((await readJson(path.join(root, "package.json"))).version, "1.49.1");
  assert.equal((await readJson(path.join(root, "package-lock.json"))).version, "1.49.1");
  assert.equal(
    (await readJson(path.join(root, "package-lock.json"))).packages[""].version,
    "1.49.1",
  );
  assert.equal((await readJson(path.join(root, "frontend", "package.json"))).version, "1.49.1");
  assert.equal(
    (await readJson(path.join(root, "frontend", "package-lock.json"))).version,
    "1.49.1",
  );
  assert.equal(
    (await readJson(path.join(root, "frontend", "package-lock.json"))).packages[""].version,
    "1.49.1",
  );
});
