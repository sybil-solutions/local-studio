import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { piRuntimeManager } from "@/lib/agent/pi-runtime";
import { POST } from "./route";

vi.mock("@/lib/agent/pi-runtime", () => ({
  piRuntimeManager: {
    getSession: vi.fn(),
  },
}));

const getSession = vi.mocked(piRuntimeManager.getSession);

describe("POST /api/agent/compact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts compaction with only active sanitized plugin and skill selections", async () => {
    const session = {
      ensureStarted: vi.fn().mockResolvedValue(undefined),
      compact: vi.fn().mockResolvedValue({ ok: true }),
      status: { piSessionId: "pi-1", active: false },
    };
    getSession.mockReturnValue(session as never);

    const response = await POST(
      new NextRequest("http://localhost/api/agent/compact", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "tab-1",
          modelId: "hy3-preview",
          cwd: "/repo",
          piSessionId: "pi-1",
          plugins: [
            { id: "browser", name: "browser-use", enabled: true, skillPath: "/browser/skills" },
            { id: "computer", name: "computer-use", enabled: false, skillPath: "/nope" },
          ],
          skills: [{ id: "agent", name: "agent-browser", path: "/skills/agent-browser" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const startOptions = session.ensureStarted.mock.calls[0]?.[3];
    expect(session.ensureStarted).toHaveBeenCalledWith(
      "hy3-preview",
      "/repo",
      "pi-1",
      expect.any(Object),
    );
    expect(startOptions).toMatchObject({
      browserToolEnabled: false,
      plugins: [
        { id: "browser", name: "browser-use", enabled: true, skillPath: "/browser/skills" },
      ],
      skills: [{ id: "agent", name: "agent-browser", path: "/skills/agent-browser" }],
    });
    expect(startOptions.plugins).toHaveLength(1);
    expect(session.compact).toHaveBeenCalledWith(
      expect.stringContaining("Enabled plugins: @browser-use."),
    );
    expect(session.compact).toHaveBeenCalledWith(expect.not.stringContaining("@computer-use"));
  });
});
