// CRITICAL
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { getApiSettings } from "@/lib/api-settings";

vi.mock("@/lib/api-settings", () => ({
  getApiSettings: vi.fn(),
}));

const getApiSettingsMock = vi.mocked(getApiSettings);

describe("POST /api/voice/speak", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env["VLLM_STUDIO_MOCK_VOICE"];
  });

  afterEach(() => {
    delete process.env["VLLM_STUDIO_MOCK_VOICE"];
  });

  it("returns 400 when input is missing", async () => {
    const request = new NextRequest("http://localhost/api/voice/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toContain("Missing 'input' text");
  });

  it("proxies speech requests to the resolved voice target", async () => {
    getApiSettingsMock.mockResolvedValue({
      backendUrl: "http://localhost:8080",
      apiKey: "settings-api-key",
      voiceUrl: "",
      voiceModel: "whisper-large-v3",
    });

    const upstreamFetch = vi.fn(async () => {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "audio/wav" },
      });
    });

    vi.stubGlobal("fetch", upstreamFetch);

    const request = new NextRequest("http://localhost/api/voice/speak", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer incoming-token",
      },
      body: JSON.stringify({ input: "hello", response_format: "wav" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/wav");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));

    expect(upstreamFetch).toHaveBeenCalledWith(
      "http://localhost:8080/v1/audio/speech",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer incoming-token",
        }),
      }),
    );
  });

  it("returns deterministic mock audio when VLLM_STUDIO_MOCK_VOICE=1", async () => {
    process.env["VLLM_STUDIO_MOCK_VOICE"] = "1";

    const request = new NextRequest("http://localhost/api/voice/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "hello" }),
    });

    const response = await POST(request);
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/wav");
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("RIFF");
  });
});
