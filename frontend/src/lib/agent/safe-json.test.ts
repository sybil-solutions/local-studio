import { describe, expect, it, vi } from "vitest";
import { safeJson } from "./safe-json";

describe("agent safeJson", () => {
  it("returns parsed JSON or an empty object for empty successful responses", async () => {
    await expect(safeJson<{ ok: boolean }>(new Response('{"ok":true}'))).resolves.toEqual({
      ok: true,
    });
    await expect(safeJson(new Response(""))).resolves.toEqual({});
  });

  it("turns malformed or failing responses into stable errors", async () => {
    await expect(safeJson(new Response("not-json"))).rejects.toThrow(
      "Malformed response from server",
    );
    await expect(safeJson(new Response("not-json", { status: 500 }))).rejects.toThrow("HTTP 500");
    await expect(safeJson(new Response("", { status: 404 }))).rejects.toThrow("HTTP 404");
  });

  it("reports body read failures without leaking SyntaxError details", async () => {
    const response = {
      ok: true,
      status: 200,
      text: vi.fn().mockRejectedValue(new Error("stream aborted")),
    } as unknown as Response;

    await expect(safeJson(response)).rejects.toThrow("Failed to read response: stream aborted");
  });
});
