import { expect, test, type Page } from "@playwright/test";

const sse = (...payloads: unknown[]) =>
  payloads.map((payload) => `data: ${JSON.stringify(payload)}\n\n`).join("");

async function mockAppApis(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("vllm-studio-setup-complete", "true");
    window.localStorage.setItem("vllmstudio_backend_url", "http://127.0.0.1:8080");
    window.localStorage.setItem(
      "vllm-studio.controllers",
      JSON.stringify(["http://127.0.0.1:8081"]),
    );
  });

  await page.route("**/api/settings", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        backendUrl: "http://127.0.0.1:8080",
        apiKey: "",
        hasApiKey: false,
        voiceUrl: "",
        voiceModel: "whisper-large-v3-turbo",
      }),
    });
  });
  await page.route("**/api/agent/projects", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        projects: [
          {
            id: "project-1",
            name: "Fixture project",
            path: "/tmp/fixture-project",
            addedAt: "2026-05-09T00:00:00.000Z",
            exists: true,
            hasGit: false,
            branch: null,
          },
        ],
      }),
    });
  });
  await page.route("**/api/agent/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        models: [
          {
            id: "test-model",
            name: "test-model",
            provider: "vllm-studio",
            contextWindow: 32768,
            maxTokens: 4096,
            reasoning: false,
            active: true,
          },
        ],
      }),
    });
  });
  await page.route("**/api/agent/setup-checks", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        checks: [
          { id: "pi", label: "Pi agent binary", ok: true, value: "/usr/bin/pi", guidance: "ok" },
        ],
      }),
    });
  });
  await page.route("**/api/agent/plugins", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        plugins: [
          {
            id: "browser-use",
            name: "browser-use",
            displayName: "Browser Use",
            source: "openai-bundled",
            path: "/tmp/browser-use",
            installed: true,
            enabled: true,
          },
          {
            id: "computer-use",
            name: "computer-use",
            path: "/tmp/computer-use",
            installed: true,
            enabled: true,
          },
        ],
        validation: { browserUseAvailable: true, computerUseAvailable: true },
      }),
    });
  });
  await page.route("**/api/agent/skills", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        skills: [
          {
            id: "skill:browser",
            name: "browser-use:browser",
            source: "~/.codex",
            path: "/tmp/browser-skill",
          },
          { id: "skill:test", name: "test skill", source: "~/.codex", path: "/tmp/skill" },
        ],
      }),
    });
  });
  await page.route("**/api/agent/skills/load**", async (route) => {
    const url = new URL(route.request().url());
    const skillPath = url.searchParams.get("path") ?? "";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        skill: {
          id: skillPath.includes("browser") ? "skill:browser" : "skill:test",
          name: skillPath.includes("browser") ? "browser-use:browser" : "test skill",
          source: "~/.codex",
          path: skillPath,
          instructions: "Use fixture browser automation instructions.",
        },
      }),
    });
  });
  await page.route("**/api/agent/sessions/all**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ sessions: [] }),
    });
  });

  await page.route("**/api/proxy/status", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ running: false, process: null, inference_port: 8000 }),
    });
  });
  await page.route("**/api/proxy/config", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        config: {
          host: "127.0.0.1",
          port: 8080,
          inference_port: 8000,
          models_dir: "/models",
          data_dir: "/data",
          db_path: "/data/controller.db",
          api_key_configured: false,
        },
        environment: {
          controller_url: "http://127.0.0.1:8080",
          inference_url: "http://127.0.0.1:8000",
          frontend_url: "http://localhost:3001",
        },
        runtime: {
          platform: { kind: "unknown" },
          gpus: { count: 0, types: [] },
          cuda: {},
        },
        services: [],
      }),
    });
  });
  await page.route("**/api/proxy/compat", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ checks: [] }) });
  });
  await page.route("**/api/proxy/logs", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ sessions: [{ id: "controller", model: "test-model" }] }),
    });
  });
  await page.route("**/api/proxy/logs/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ logs: ["controller booted", "ready"] }),
    });
  });
  await page.route("**/api/proxy/recipes", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify([]) });
  });
  await page.route("**/api/proxy/gpus", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ gpus: [] }) });
  });
  await page.route("**/api/proxy/v1/metrics/vllm", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ generation_throughput: 12, prompt_throughput: 44, avg_ttft_ms: 88 }),
    });
  });
  await page.route("**/api/proxy/events**", async (route) => {
    await route.fulfill({ contentType: "text/event-stream", body: "" });
  });
  await page.route("**/api/proxy/studio/downloads", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ downloads: [] }),
    });
  });
  await page.route("**/api/proxy/studio/models", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ models: [] }) });
  });
  await page.route("**/api/proxy/v1/studio/models", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ models: [] }) });
  });
  await page.route("**/api/proxy/studio/recommendations", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ recommendations: [], max_vram_gb: 0 }),
    });
  });
  await page.route("**/api/proxy/runtime/targets", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ targets: [] }) });
  });
  await page.route("**/api/proxy/v1/huggingface/models**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          _id: "Qwen/Qwen3.6-27B",
          modelId: "Qwen/Qwen3.6-27B",
          downloads: 100,
          likes: 10,
          tags: ["text-generation"],
          private: false,
        },
      ]),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await mockAppApis(page);
});

test("agent new chat surface renders with composer guidance", async ({ page }) => {
  await page.goto("/agent?new=1");
  await expect(page.getByText(/A dream is something you build/)).toBeVisible();
  await expect(page.getByPlaceholder(/Ask test-model/)).toBeVisible();
});

test("agent composer loads plugins with @ and skills with $ as tabs", async ({ page }) => {
  let turnRequest: { browserToolEnabled?: boolean; message?: string } | null = null;
  await page.route("**/api/agent/turn", async (route) => {
    turnRequest = route.request().postDataJSON();
    await route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"type":"status","phase":"done"}\n\n',
    });
  });

  await page.goto("/agent?new=1");
  const composer = page.getByPlaceholder(/Ask test-model/);
  await composer.fill("@");
  await page.getByRole("button", { name: /@Computer Use/ }).click();
  await expect(page.getByRole("button", { name: "Unload @Computer Use" })).toBeVisible();

  await composer.fill("$browser");
  await page.getByRole("button", { name: /\$browser-use:browser/ }).click();
  await expect(page.getByRole("button", { name: "Unload $browser-use:browser" })).toBeVisible();

  await composer.fill("use selected tools");
  await composer.press("Enter");
  await expect.poll(() => turnRequest?.message ?? "").toContain("Enabled plugins:");
  const capturedTurn = turnRequest as { browserToolEnabled?: boolean; message?: string } | null;
  expect(capturedTurn?.message).toContain("Computer Use");
});

test("agent sends steer and follow-up controls to Pi while running", async ({ page }) => {
  const turnRequests: Array<{ mode?: string; message?: string }> = [];
  await page.route("**/api/agent/turn", async (route) => {
    const body = route.request().postDataJSON() as { mode?: string; message?: string };
    turnRequests.push(body);
    await route.fulfill({
      contentType: "text/event-stream",
      body: body.mode
        ? sse(
            { type: "status", phase: "queued", queue: body.mode },
            { type: "status", phase: "done" },
          )
        : sse(
            { type: "status", phase: "starting", sessionId: "rt-running" },
            { type: "status", phase: "running", piSessionId: "pi-running" },
            {
              type: "pi",
              seq: 1,
              event: {
                type: "message_update",
                assistantMessageEvent: { type: "text_delta", delta: "working" },
              },
            },
          ),
    });
  });
  await page.route("**/api/agent/runtime/status**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ status: { active: true, piSessionId: "pi-running", eventSeq: 1 } }),
    });
  });
  await page.route("**/api/agent/runtime/events**", async (route) => {
    await route.fulfill({
      contentType: "text/event-stream",
      body: sse({ type: "status", phase: "running", session: { piSessionId: "pi-running" } }),
    });
  });

  await page.goto("/agent?new=1");
  const composer = page.getByPlaceholder(/Ask test-model/);
  await composer.fill("start long run");
  await composer.press("Enter");
  await expect(page.getByText(/Pi is running/)).toBeVisible();
  await expect(page.getByPlaceholder(/Steer test-model/)).toBeVisible();

  const runningComposer = page.getByPlaceholder(/test-model/);
  await runningComposer.fill("steer now");
  await runningComposer.press("Enter");
  await expect.poll(() => turnRequests.some((request) => request.mode === "steer")).toBe(true);

  await runningComposer.fill("follow later");
  await runningComposer.press("Tab");
  await expect(page.getByRole("button", { name: /queue 1 follow later/ })).toBeVisible();
  await expect.poll(() => turnRequests.some((request) => request.mode === "follow_up")).toBe(true);
});

test("agent session reattaches after navigation and survives mixed tool calls", async ({
  page,
}) => {
  let replayEnabled = false;
  const replayWaiters: Array<() => void> = [];
  const enableReplay = () => {
    replayEnabled = true;
    replayWaiters.splice(0).forEach((resolve) => resolve());
  };
  const waitForReplay = () =>
    replayEnabled ? Promise.resolve() : new Promise<void>((resolve) => replayWaiters.push(resolve));

  await page.route("**/api/agent/turn", async (route) => {
    await route.fulfill({
      contentType: "text/event-stream",
      body: sse(
        { type: "status", phase: "starting", sessionId: "rt-stream" },
        { type: "status", phase: "running", piSessionId: "pi-stream" },
        { type: "pi", seq: 1, event: { type: "session", id: "pi-stream" } },
        {
          type: "pi",
          seq: 2,
          event: {
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: "partial before nav " },
          },
        },
      ),
    });
  });
  await page.route("**/api/agent/runtime/status**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        status: { active: true, piSessionId: "pi-stream", eventSeq: 2 },
      }),
    });
  });
  await page.route("**/api/agent/sessions/pi-stream**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        events: [
          { type: "message", message: { role: "user", content: "stream across nav" } },
          {
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: "partial before nav " },
          },
        ],
      }),
    });
  });
  await page.route("**/api/agent/runtime/events**", async (route) => {
    await waitForReplay();
    await route
      .fulfill({
        contentType: "text/event-stream",
        body: sse(
          { type: "status", phase: "running", session: { piSessionId: "pi-stream" } },
          {
            type: "pi",
            seq: 3,
            event: { type: "tool_execution_start", toolCallId: "tool-read", toolName: "read" },
          },
          {
            type: "pi",
            seq: 4,
            event: {
              type: "tool_execution_end",
              toolCallId: "tool-read",
              toolName: "read",
              result: { content: [{ type: "text", text: "read ok" }] },
            },
          },
          {
            type: "pi",
            seq: 5,
            event: { type: "tool_execution_start", toolCallId: "tool-shell", toolName: "shell" },
          },
          {
            type: "pi",
            seq: 6,
            event: {
              type: "tool_execution_end",
              toolCallId: "tool-shell",
              toolName: "shell",
              isError: true,
              result: { content: [{ type: "text", text: "shell failed" }] },
            },
          },
          {
            type: "pi",
            seq: 7,
            event: {
              type: "message_update",
              assistantMessageEvent: { type: "text_delta", delta: "after reattach" },
            },
          },
        ),
      })
      .catch(() => undefined);
  });

  await page.goto("/agent?new=1");
  const composer = page.getByPlaceholder(/Ask test-model/);
  await composer.fill("stream across nav");
  await composer.press("Enter");
  await expect(page.getByText("partial before nav")).toBeVisible();

  await page.goto("/server");
  enableReplay();
  await page.goto("/agent");

  await expect(page.getByText("partial before nav")).toBeVisible();
  await expect(page.getByPlaceholder(/Ask test-model/)).toBeVisible();
});

test("archived active sessions are excluded from restart hydration", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "vllm-studio.agent.activeSessions.snapshot",
      JSON.stringify([
        {
          projectId: "project-1",
          cwd: "/tmp/fixture-project",
          paneId: "p-archived",
          tabId: "tab-archived",
          piSessionId: "pi-archived",
          modelId: "test-model",
          title: "Archived should stay hidden",
          status: "running",
          active: true,
          updatedAt: "2026-05-09T00:00:00.000Z",
        },
      ]),
    );
    window.localStorage.setItem(
      "vllm-studio.agent.sessionPrefs",
      JSON.stringify({ "pi-archived": { hidden: true } }),
    );
  });

  await page.goto("/agent");
  await expect(page.getByText("Archived should stay hidden")).toHaveCount(0);
  await expect(page.getByText(/A dream is something you build/)).toBeVisible();
});

test("settings exposes archive, plugin, skill, setup, and controller surfaces", async ({
  page,
}) => {
  await page.goto("/settings#plugins");
  await expect(page.getByRole("heading", { name: "Plugin registry" })).toBeVisible();
  await expect(page.getByText("Computer-use", { exact: true })).toBeVisible();
  await expect(page.getByText("Browser-use", { exact: true })).toBeVisible();

  await page.goto("/settings#skills");
  await expect(page.getByText("test skill")).toBeVisible();

  await page.goto("/settings#setup");
  await expect(page.getByText("Controller connection")).toBeVisible();
});

test("models page exposes search, running models, and downloads sections", async ({ page }) => {
  await page.goto("/recipes");
  await expect(page.getByRole("button", { name: "Search Models" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Current Running Models" })).toBeVisible();
  await page.getByRole("button", { name: "Downloads" }).click();
  await expect(page.getByText("No downloads")).toBeVisible();
});

test("models search keeps base models first and expands derivatives before download tracking", async ({
  page,
}) => {
  let downloads: Array<Record<string, unknown>> = [];
  await page.unroute("**/api/proxy/studio/downloads");
  await page.route("**/api/proxy/v1/huggingface/models**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          _id: "Qwen/Qwen3.6-27B",
          modelId: "Qwen/Qwen3.6-27B",
          downloads: 100,
          likes: 10,
          tags: ["text-generation", "base"],
          private: false,
        },
        {
          _id: "some-org/Qwen3.6-27B-GGUF",
          modelId: "some-org/Qwen3.6-27B-GGUF",
          downloads: 200,
          likes: 20,
          tags: ["text-generation", "gguf"],
          private: false,
        },
      ]),
    });
  });
  await page.route("**/api/proxy/studio/downloads", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { model_id: string };
      downloads = [
        {
          id: "download-1",
          model_id: body.model_id,
          revision: null,
          status: "downloading",
          created_at: "2026-05-09T00:00:00.000Z",
          updated_at: "2026-05-09T00:01:00.000Z",
          target_dir: `/models/${body.model_id}`,
          total_bytes: 1000,
          downloaded_bytes: 250,
          files: [],
          error: null,
        },
      ];
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ download: downloads[0] }),
      });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ downloads }) });
  });

  await page.goto("/recipes");
  await page.getByRole("button", { name: "Search Models" }).click();
  await page.getByPlaceholder("Search Hugging Face models").fill("Qwen3.6-27B");
  await expect(page.getByText("Qwen/Qwen3.6-27B")).toBeVisible();
  await expect(page.getByText("Qwen3.6-27B-GGUF")).toHaveCount(0);

  await page.getByTitle("Show variants").click();
  await expect(page.getByText("Qwen3.6-27B-GGUF")).toBeVisible();
  const baseRow = page
    .getByText("Qwen/Qwen3.6-27B", { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'my-1')][1]");
  await baseRow.getByRole("button", { name: /^Download$/ }).click();

  await page.getByRole("button", { name: "Downloads" }).click();
  await expect(page.getByText("Qwen/Qwen3.6-27B", { exact: true })).toBeVisible();
  await expect(page.getByText("250 B / 1000 B · 25%")).toBeVisible();
});

test("status page shows controller tabs, scrollable logs, and nonzero runtime metrics", async ({
  page,
}) => {
  await page.unroute("**/api/proxy/status");
  await page.unroute("**/api/proxy/v1/metrics/vllm");
  await page.unroute("**/api/proxy/recipes");
  await page.route("**/api/proxy/status", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        running: true,
        inference_port: 8000,
        process: {
          pid: 1234,
          backend: "vllm",
          model_path: "/models/test-model",
          port: 8000,
          served_model_name: "test-model",
        },
      }),
    });
  });
  await page.route("**/api/proxy/v1/metrics/vllm", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        model_id: "test-model",
        served_model_name: "test-model",
        generation_throughput: 12,
        prompt_throughput: 44,
        avg_ttft_ms: 88,
        total_tokens: 300,
        prompt_tokens_total: 120,
        generation_tokens_total: 180,
        latency_avg: 456,
        running_requests: 1,
      }),
    });
  });
  await page.route("**/api/proxy/recipes", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "recipe-test",
          name: "test-model",
          backend: "vllm",
          model_path: "/models/test-model",
          status: "running",
        },
      ]),
    });
  });

  await page.goto("/");
  await expect(page.getByText("controllers")).toBeVisible();
  await expect(page.getByRole("button", { name: "primary" })).toBeVisible();
  await expect(page.getByRole("button", { name: "controller 2" })).toBeVisible();
  await expect(page.getByText("Decode")).toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("vllm:controller-event", {
        detail: {
          type: "status",
          data: {
            running: true,
            inference_port: 8000,
            process: {
              pid: 1234,
              backend: "vllm",
              model_path: "/models/test-model",
              port: 8000,
              served_model_name: "test-model",
            },
          },
        },
      }),
    );
    window.dispatchEvent(
      new CustomEvent("vllm:controller-event", {
        detail: {
          type: "metrics",
          data: {
            model_id: "test-model",
            served_model_name: "test-model",
            generation_throughput: 12,
            prompt_throughput: 44,
            avg_ttft_ms: 88,
            total_tokens: 300,
            prompt_tokens_total: 120,
            generation_tokens_total: 180,
            latency_avg: 456,
            running_requests: 1,
          },
        },
      }),
    );
  });
  await expect(page.getByText("12.0")).toBeVisible();
  await expect(page.getByText("TTFT", { exact: true })).toBeVisible();
  await expect(page.getByText("88")).toBeVisible();
  await expect(page.getByText("Prefill")).toBeVisible();
  await expect(page.getByText("44.0")).toBeVisible();
  await expect(page.getByText("total tokens")).toBeVisible();
  await expect(page.getByText("300")).toBeVisible();
  await expect(page.getByText("Controller logs")).toBeVisible();
  await expect(page.getByText("controller booted")).toBeVisible();
});

test("server page exposes health, logs, and API docs tab", async ({ page }) => {
  await page.goto("/server");
  await expect(page.getByText("Server Health")).toBeVisible();
  await expect(page.getByText("Server Logs")).toBeVisible();
  await page.getByRole("button", { name: "API Docs" }).click();
  await expect(page.getByText("OpenAPI reference")).toBeVisible();
});
