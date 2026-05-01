import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { getUsageFromPiSessions } from "./pi-sessions";

describe("getUsageFromPiSessions", () => {
  it("aggregates assistant usage by model from Pi session JSONL files", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-sessions-"));
    const cwdDirectory = join(root, "--repo--");
    mkdirSync(cwdDirectory);
    writeFileSync(
      join(cwdDirectory, "session.jsonl"),
      [
        JSON.stringify({ type: "session", id: "session-a", timestamp: "2026-04-30T10:00:00.000Z" }),
        JSON.stringify({
          type: "model_change",
          modelId: "mimo-v2.5",
          timestamp: "2026-04-30T10:00:00.000Z",
        }),
        JSON.stringify({
          type: "message",
          timestamp: "2026-04-30T10:01:00.000Z",
          message: {
            role: "assistant",
            model: "mimo-v2.5",
            timestamp: Date.parse("2026-04-30T10:01:00.000Z"),
            usage: { input: 100, output: 25, totalTokens: 125 },
          },
        }),
      ].join("\n")
    );

    const stats = getUsageFromPiSessions(root, new Date("2026-04-30T11:00:00.000Z"));
    expect(stats?.["totals"]).toMatchObject({
      total_requests: 1,
      total_tokens: 125,
      prompt_tokens: 100,
      completion_tokens: 25,
      unique_sessions: 1,
    });
    expect((stats?.["by_model"] as Array<Record<string, unknown>>)[0]).toMatchObject({
      model: "mimo-v2.5",
      requests: 1,
      total_tokens: 125,
    });
    expect((stats?.["daily_by_model"] as Array<Record<string, unknown>>)[0]).toMatchObject({
      date: "2026-04-30",
      model: "mimo-v2.5",
      total_tokens: 125,
    });
  });
});
