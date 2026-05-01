import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiCore } from "./core";
import { clearStoredBackendUrl, getStoredBackendUrl } from "../backend-url";

vi.mock("../backend-url", () => ({
  getStoredBackendUrl: vi.fn(),
  clearStoredBackendUrl: vi.fn(),
}));

vi.mock("../api-key", () => ({
  getApiKey: vi.fn(() => ""),
}));

const getStoredBackendUrlMock = vi.mocked(getStoredBackendUrl);
const clearStoredBackendUrlMock = vi.mocked(clearStoredBackendUrl);

const encode = (text: string) => new TextEncoder().encode(text);

const sseResponse = (chunks: string[], headers?: Record<string, string>) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encode(chunk));
        }
        controller.close();
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        ...(headers ?? {}),
      },
    },
  );

describe("createApiCore", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getStoredBackendUrlMock.mockReturnValue("http://localhost:8080");
  });

  it("clears stale backend override when proxy marks it invalid", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Backend-Override-Invalid": "1",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const core = createApiCore({ baseUrl: "/api/proxy", useProxy: true });
    await core.request("/status", { retries: 0 });

    expect(clearStoredBackendUrlMock).toHaveBeenCalledTimes(1);
  });

  it("retries once without a stale backend override when the proxy rejects it", async () => {
    getStoredBackendUrlMock.mockReturnValue("http://localhost:8080");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "blocked" }), {
          status: 403,
          headers: {
            "Content-Type": "application/json",
            "X-Backend-Override-Invalid": "1",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const core = createApiCore({ baseUrl: "/api/proxy", useProxy: true });
    const result = await core.request<{ ok: boolean }>("/recipes", { retries: 0 });

    expect(result.ok).toBe(true);
    expect(clearStoredBackendUrlMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "X-Backend-Url": "http://localhost:8080",
    });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).not.toHaveProperty("X-Backend-Url");
  });

  it("does not clear backend override when no invalid marker is present", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const core = createApiCore({ baseUrl: "/api/proxy", useProxy: true });
    await core.request("/status", { retries: 0 });

    expect(clearStoredBackendUrlMock).not.toHaveBeenCalled();
  });

  it("parses canonical SSE events from event lines", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sseResponse(
          [
            "event: run_start\n",
            'data: {"run_id":"r1","session_id":"s1"}\n\n',
            "event: run_end\n",
            'data: {"run_id":"r1","session_id":"s1","status":"completed","error":null}\n\n',
          ],
          { "X-Run-Id": "r1" },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const core = createApiCore({ baseUrl: "/api/proxy", useProxy: true });
    const { runId, stream } = await core.postSseJson("/chats/s1/turn", { content: "hello" });

    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    for await (const entry of stream) {
      events.push(entry);
    }

    expect(runId).toBe("r1");
    expect(events.map((entry) => entry.event)).toEqual(["run_start", "run_end"]);
    expect(events[1]?.data["status"]).toBe("completed");
  });

  it("unwraps legacy SSE payloads wrapped as data.event/data", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          'data: {"event":"run_start","data":{"run_id":"legacy-1","session_id":"s1"}}\n\n',
          'data: {"event":"run_end","data":{"run_id":"legacy-1","session_id":"s1","status":"completed","error":null}}\n\n',
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const core = createApiCore({ baseUrl: "/api/proxy", useProxy: true });
    const { stream } = await core.postSseJson("/chats/s1/turn", { content: "hello" });

    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    for await (const entry of stream) {
      events.push(entry);
    }

    expect(events.map((entry) => entry.event)).toEqual(["run_start", "run_end"]);
    expect(events[1]?.data["run_id"]).toBe("legacy-1");
    expect(events[1]?.data["status"]).toBe("completed");
  });

  it("unwraps legacy SSE payloads wrapped as data.type/payload", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          'data: {"type":"run_start","payload":{"run_id":"legacy-2","session_id":"s2"}}\n\n',
          'data: {"type":"run_end","payload":{"run_id":"legacy-2","session_id":"s2","status":"completed","error":null}}\n\n',
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const core = createApiCore({ baseUrl: "/api/proxy", useProxy: true });
    const { stream } = await core.postSseJson("/chats/s2/turn", { content: "hello" });

    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    for await (const entry of stream) {
      events.push(entry);
    }

    expect(events.map((entry) => entry.event)).toEqual(["run_start", "run_end"]);
    expect(events[1]?.data["run_id"]).toBe("legacy-2");
    expect(events[1]?.data["status"]).toBe("completed");
  });

  it("ends SSE stream gracefully when the body reader throws a transport close (no Bun hint surfaced)", async () => {
    let pulls = 0;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls += 1;
            if (pulls === 1) {
              controller.enqueue(encode('event: run_start\ndata: {"run_id":"t1"}\n\n'));
              return;
            }
            return Promise.reject(
              new Error(
                "The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()",
              ),
            );
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream", "X-Run-Id": "t1" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const core = createApiCore({ baseUrl: "/api/proxy", useProxy: true });
    const { stream } = await core.postSseJson("/chats/s1/turn", { content: "hello" });

    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    for await (const entry of stream) {
      events.push(entry);
    }

    expect(events.map((e) => e.event)).toEqual(["run_start"]);
  });
});
