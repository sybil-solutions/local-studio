import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { migrateLegacyUserData } from "../desktop/logic/user-data-migration";

test("desktop legacy user-data migration copies missing state without overwriting canonical state", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vllm-userdata-migrate-"));
  const legacyDir = path.join(root, "frontend");
  const targetDir = path.join(root, "Local Studio");

  mkdirSync(path.join(legacyDir, "Local Storage"), { recursive: true });
  mkdirSync(path.join(legacyDir, "mcp"), { recursive: true });
  mkdirSync(targetDir, { recursive: true });

  writeFileSync(path.join(legacyDir, "projects.json"), '{"projects":[{"id":"old"}]}\n');
  writeFileSync(path.join(targetDir, "projects.json"), '{"projects":[{"id":"new"}]}\n');
  writeFileSync(path.join(legacyDir, "embedded-frontend.port"), "61449");
  writeFileSync(path.join(legacyDir, "Local Storage", "leveldb"), "renderer-state");
  writeFileSync(path.join(legacyDir, "mcp", "registries.json"), '{"sources":[]}\n');

  const first = migrateLegacyUserData({ legacyDir, targetDir });
  assert.deepEqual(first, ["Local Storage", "embedded-frontend.port", "mcp"]);
  assert.equal(
    readFileSync(path.join(targetDir, "projects.json"), "utf8"),
    '{"projects":[{"id":"new"}]}\n',
  );
  assert.equal(readFileSync(path.join(targetDir, "embedded-frontend.port"), "utf8"), "61449");
  assert.equal(
    readFileSync(path.join(targetDir, "Local Storage", "leveldb"), "utf8"),
    "renderer-state",
  );
  assert.equal(
    readFileSync(path.join(targetDir, "mcp", "registries.json"), "utf8"),
    '{"sources":[]}\n',
  );

  assert.deepEqual(migrateLegacyUserData({ legacyDir, targetDir }), []);
  assert.equal(existsSync(path.join(targetDir, "legacy-user-data-migration-v1.json")), true);
});
