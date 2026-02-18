// CRITICAL
import { describe, expect, it, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobStore } from "../stores/job-store";

let store: JobStore;
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "job-store-test-"));
  store = new JobStore(join(tmpDir, "test.db"));
});

describe("JobStore", () => {
  it("creates and retrieves a job", () => {
    const job = store.create("j1", "voice_assistant_turn", { text: "hello" });
    expect(job.id).toBe("j1");
    expect(job.type).toBe("voice_assistant_turn");
    expect(job.status).toBe("pending");
    expect(job.progress).toBe(0);

    const fetched = store.get("j1");
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe("j1");
  });

  it("lists jobs and returns both", () => {
    store.create("j1", "voice_assistant_turn", {});
    store.create("j2", "voice_assistant_turn", {});
    const list = store.list();
    expect(list.length).toBe(2);
    const ids = list.map((j) => j.id).sort();
    expect(ids).toEqual(["j1", "j2"]);
  });

  it("updates status and progress", () => {
    store.create("j1", "voice_assistant_turn", {});
    store.update("j1", { status: "running", progress: 50 });
    const job = store.get("j1")!;
    expect(job.status).toBe("running");
    expect(job.progress).toBe(50);
  });

  it("appends and truncates logs", () => {
    store.create("j1", "voice_assistant_turn", {});
    for (let i = 0; i < 250; i++) {
      store.appendLog("j1", `line ${i}`);
    }
    const job = store.get("j1")!;
    const logs = JSON.parse(job.logs) as string[];
    expect(logs.length).toBeLessThanOrEqual(200);
    expect(logs[logs.length - 1]).toBe("line 249");
  });

  it("handles terminal states", () => {
    store.create("j1", "voice_assistant_turn", {});
    store.update("j1", { status: "completed", progress: 100, result: '{"ok":true}' });
    const job = store.get("j1")!;
    expect(job.status).toBe("completed");
    expect(job.result).toBe('{"ok":true}');
  });

  it("handles failure state", () => {
    store.create("j1", "voice_assistant_turn", {});
    store.update("j1", { status: "failed", error: "boom" });
    const job = store.get("j1")!;
    expect(job.status).toBe("failed");
    expect(job.error).toBe("boom");
  });

  it("returns null for unknown job", () => {
    expect(store.get("nonexistent")).toBeNull();
  });
});
