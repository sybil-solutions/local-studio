import { describe, expect, it } from "vitest";
import { normalizePersistedTab, setupWarningFromPiCheck } from "@/lib/agent/workspace/store";

describe("normalizePersistedTab", () => {
  it("preserves selected plugin and skill tabs across pane-state restore", () => {
    const restored = normalizePersistedTab({
      id: "tab-1",
      runtimeSessionId: "rt-1",
      piSessionId: "pi-1",
      title: "With context",
      messages: [],
      status: "idle",
      input: "",
      plugins: [{ id: "browser", name: "browser-use", enabled: true }],
      skills: [{ id: "agent-browser", name: "agent-browser", path: "/skills/agent-browser" }],
    });

    expect(restored).toMatchObject({
      id: "tab-1",
      runtimeSessionId: "rt-1",
      plugins: [{ id: "browser", name: "browser-use", enabled: true }],
      skills: [{ id: "agent-browser", name: "agent-browser", path: "/skills/agent-browser" }],
    });
  });
});

describe("setupWarningFromPiCheck", () => {
  it("does not show a missing-pi warning once usable models are loaded", () => {
    expect(
      setupWarningFromPiCheck(
        { ok: false, guidance: "Install @mariozechner/pi-coding-agent" },
        true,
      ),
    ).toBe("");
  });

  it("shows guidance when Pi is missing and no models are usable", () => {
    expect(setupWarningFromPiCheck({ ok: false, guidance: "Install Pi" }, false)).toBe(
      "Install Pi",
    );
  });
});
