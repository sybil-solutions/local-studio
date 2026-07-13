import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { encodeCwdForPi } from "@local-studio/agent-runtime/sessions-store";

async function loadSessionModules() {
  const [
    { listSessions },
    { listArchivedSessionMetadata, setSessionArchived },
  ] = await Promise.all([
    import("@local-studio/agent-runtime/sessions-store"),
    import("@local-studio/agent-runtime/session-metadata-store"),
  ]);
  return { listArchivedSessionMetadata, listSessions, setSessionArchived };
}

test("archived durable agent sessions are hidden by default and restorable", async () => {
  const previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  const root = mkdtempSync(path.join(tmpdir(), "local-studio-session-archive-"));
  const cwd = path.join(root, "workspace");
  const piAgentDir = path.join(root, "pi-agent");
  const dataDir = path.join(root, "data");
  const sessionId = "archive-regression-session";
  const archivedAt = new Date("2026-05-28T12:34:56.000Z");

  try {
    mkdirSync(cwd, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(path.join(dataDir, "api-settings.json"), "{}\n", "utf-8");

    const sessionDir = path.join(piAgentDir, "sessions", encodeCwdForPi(cwd));
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      path.join(sessionDir, `${sessionId}.jsonl`),
      [
        JSON.stringify({
          type: "session",
          id: sessionId,
          cwd,
          timestamp: "2026-05-28T12:00:00.000Z",
          modelId: "deepseek-v4-flash",
          provider: "local-studio",
        }),
        JSON.stringify({
          type: "user_message",
          content: "Keep archived chat sessions durable",
        }),
      ].join("\n") + "\n",
      "utf-8",
    );

    process.env.PI_CODING_AGENT_DIR = piAgentDir;
    process.env.LOCAL_STUDIO_DATA_DIR = dataDir;

    const { listArchivedSessionMetadata, listSessions, setSessionArchived } =
      await loadSessionModules();

    const defaultSessions = await listSessions(cwd);
    assert.equal(defaultSessions.length, 1);
    assert.equal(defaultSessions[0]?.id, sessionId);
    assert.equal(defaultSessions[0]?.archived, false);
    assert.equal(defaultSessions[0]?.archivedAt, null);

    const archiveState = setSessionArchived(sessionId, true, archivedAt, {
      cwd,
      projectId: "project-archive",
      projectName: "Archive Workspace",
      sessionUpdatedAt: "2026-05-28T12:00:01.000Z",
      title: "Keep archived chat sessions durable",
    });
    assert.deepEqual(archiveState, {
      archived: true,
      archivedAt: archivedAt.toISOString(),
    });

    assert.deepEqual(await listSessions(cwd), []);
    const archiveIndex = listArchivedSessionMetadata();
    assert.equal(archiveIndex.length, 1);
    assert.equal(archiveIndex[0]?.id, sessionId);
    assert.equal(archiveIndex[0]?.cwd, cwd);
    assert.equal(archiveIndex[0]?.title, "Keep archived chat sessions durable");
    assert.equal(archiveIndex[0]?.projectId, "project-archive");
    assert.equal(archiveIndex[0]?.projectName, "Archive Workspace");

    const archivedSessions = await listSessions(cwd, { archivedOnly: true });
    assert.equal(archivedSessions.length, 1);
    assert.equal(archivedSessions[0]?.id, sessionId);
    assert.equal(archivedSessions[0]?.archived, true);
    assert.equal(archivedSessions[0]?.archivedAt, archivedAt.toISOString());

    const restoreState = setSessionArchived(sessionId, false);
    assert.deepEqual(restoreState, { archived: false, archivedAt: null });

    const restoredSessions = await listSessions(cwd);
    assert.equal(restoredSessions.length, 1);
    assert.equal(restoredSessions[0]?.id, sessionId);
    assert.equal(restoredSessions[0]?.archived, false);
    assert.equal(restoredSessions[0]?.archivedAt, null);
  } finally {
    if (previousPiAgentDir === undefined)
      delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousPiAgentDir;
    if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
    rmSync(root, { recursive: true, force: true });
  }
});
