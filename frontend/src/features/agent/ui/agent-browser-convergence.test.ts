import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeBrowserInput } from "@/features/agent/tools/browser-url";
import { createBrowserHostCoordinator } from "@/features/agent/ui/agent-browser-effects";
import { resolveWorkspaceFileOpenTarget } from "@/features/agent/ui/filesystem-panel-effects";

const A = "https://page.test/a";
const B = "https://page.test/b";
const ok = { status: 200, body: { ok: true } };

test("mutations serialize, settle fresh frames, and preserve fallback state", async () => {
  const calls: string[] = [];
  const requests: PromiseWithResolvers<{ status: number; body: unknown }>[] = [];
  const transport = async (_path: string, body?: unknown) => {
    calls.push(String((body as { url?: string } | undefined)?.url ?? ""));
    const request = Promise.withResolvers<{ status: number; body: unknown }>();
    requests.push(request);
    return request.promise;
  };
  const host = createBrowserHostCoordinator(transport);
  const navigateA = host.mutate("navigate", { url: A });
  const navigateB = host.mutate("navigate", { url: B });
  await delay(0);
  assert.deepEqual(calls, [A]);
  assert.equal(host.locationIsAuthoritative(host.beginFrame()), false);
  requests[0]?.resolve(ok);
  await navigateA;
  await delay(0);
  assert.deepEqual(calls, [A, B]);
  const staleFrame = host.beginFrame();
  requests[1]?.resolve(ok);
  await navigateB;
  assert.equal(host.locationIsAuthoritative(staleFrame), false);
  assert.equal(host.locationIsAuthoritative(host.beginFrame()), true);
  const fallbackData = { url: B, readingMode: true };
  const fallback = createBrowserHostCoordinator(async () => ({
    status: 200,
    body: { ok: true, data: { ...fallbackData, title: "Reader" } },
  }));
  assert.deepEqual(await fallback.mutate("navigate", { url: A }), { error: null, ...fallbackData });
});

test("browser input never turns project paths into browser URLs", () => {
  for (const value of "file:///tmp/secret.txt|/tmp/secret.txt|./src/index.ts|../secret.txt|~/secret.txt|C:\\secret.txt|src/index.ts".split(
    "|",
  )) {
    assert.equal(normalizeBrowserInput(value), "");
  }
  assert.equal(normalizeBrowserInput("example.com"), "https://example.com");
  assert.equal(normalizeBrowserInput("localhost:3000"), "http://localhost:3000");
  assert.equal(
    normalizeBrowserInput("shared browser"),
    "https://duckduckgo.com/?q=shared%20browser",
  );
  const cwd = "/Users/me/project";
  assert.deepEqual(resolveWorkspaceFileOpenTarget(`${cwd}/src/app.ts`, cwd), {
    root: cwd,
    rel: "src/app.ts",
    kind: "file",
  });
  assert.equal(resolveWorkspaceFileOpenTarget("/Users/me/secret.txt", cwd), null);
  assert.equal(resolveWorkspaceFileOpenTarget("/tmp/secret.txt", null), null);
});

test("frontend source contains no desktop guest browser path", () => {
  const root = fileURLToPath(new URL("../../../..", import.meta.url));
  const source =
    "src/features/agent/ui/agent-browser.tsx src/features/agent/ui/agent-browser-effects.ts src/features/agent/ui/agent-browser-panel.tsx src/features/agent/ui/computer-tab-panel.tsx desktop/logic/security.ts desktop/logic/window-manager.ts"
      .split(" ")
      .map((path) => readFileSync(join(root, path), "utf8"))
      .join("\n");
  const guest = "web" + "view";
  const forbidden = [`<${guest}`, `${guest}Tag`, `will-attach-${guest}`, "is" + "Electron"];
  assert.equal(
    forbidden.some((value) => source.includes(value)),
    false,
  );
});
