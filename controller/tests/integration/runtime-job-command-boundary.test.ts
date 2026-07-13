import { describe, expect, test } from "bun:test";
import { createTestApp, registerControllerTestLifecycle } from "./fixtures";

registerControllerTestLifecycle();

describe("runtime job command boundary", () => {
  describe("POST /runtime/jobs", () => {
    test("rejects a request-controlled command field with 400", async () => {
      const app = await createTestApp();
      const response = await app.request("/runtime/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ backend: "llamacpp", type: "update", command: "whoami" }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        detail: "Request-controlled command or args are not allowed for runtime jobs",
      });
    });

    test("rejects a request-controlled args field with 400", async () => {
      const app = await createTestApp();
      const response = await app.request("/runtime/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ backend: "llamacpp", type: "update", args: ["-c", "whoami"] }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        detail: "Request-controlled command or args are not allowed for runtime jobs",
      });
    });
  });

  const upgradeRoutes = [
    "/runtime/vllm/upgrade",
    "/runtime/sglang/upgrade",
    "/runtime/llamacpp/upgrade",
    "/runtime/cuda/upgrade",
    "/runtime/rocm/upgrade",
  ] as const;

  for (const path of upgradeRoutes) {
    describe(`POST ${path}`, () => {
      test("rejects a request-controlled command field with 400", async () => {
        const app = await createTestApp();
        const response = await app.request(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ command: "whoami" }),
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          detail: "Request-controlled command or args are not allowed for runtime jobs",
        });
      });

      test("rejects a request-controlled args field with 400", async () => {
        const app = await createTestApp();
        const response = await app.request(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ args: ["-c", "whoami"] }),
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          detail: "Request-controlled command or args are not allowed for runtime jobs",
        });
      });
    });
  }
});
