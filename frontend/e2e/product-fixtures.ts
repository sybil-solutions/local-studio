import type { Page, Route } from "@playwright/test";

const usage = (totalTokens: number, model: string) => {
  const today = new Date().toISOString().slice(0, 10);
  return {
    totals: {
      total_tokens: totalTokens,
      prompt_tokens: Math.round(totalTokens * 0.82),
      completion_tokens: Math.round(totalTokens * 0.18),
      total_requests: 18_420,
      successful_requests: 18_400,
      failed_requests: 20,
      success_rate: 99.89,
      unique_sessions: 48,
      unique_users: 1,
    },
    cache: {
      hits: 12_000,
      misses: 420,
      hit_tokens: Math.round(totalTokens * 0.7),
      miss_tokens: Math.round(totalTokens * 0.05),
      hit_rate: 96.6,
    },
    by_model: [
      {
        model,
        requests: 12_400,
        successful: 12_390,
        success_rate: 99.9,
        total_tokens: Math.round(totalTokens * 0.62),
        prompt_tokens: Math.round(totalTokens * 0.5),
        completion_tokens: Math.round(totalTokens * 0.12),
        avg_tokens: 75_000,
      },
    ],
    daily: [
      {
        date: today,
        requests: 1_240,
        successful: 1_238,
        success_rate: 99.8,
        total_tokens: 95_680_000,
        prompt_tokens: 80_000_000,
        completion_tokens: 15_680_000,
        avg_latency_ms: 1_240,
      },
    ],
  };
};

const controllerPayload = (path: string) => {
  if (path === "/usage/pi-sessions") return usage(1_500_000_000, "glm-5.2");
  if (path === "/usage") return usage(450_000_000, "gpt-5.6-sol");
  if (path === "/studio/rigs") {
    return {
      local_node_id: "local",
      rigs: [
        {
          id: "workstation",
          name: "Workstation",
          description: "Local inference hardware",
          nodes: [
            {
              id: "local",
              name: "Mac Studio",
              hardware_type: "apple-silicon",
              role: "controller",
              memory_gb: 128,
              accelerators: [],
            },
          ],
        },
      ],
    };
  }
  if (path === "/recipes") return [{ id: "glm-5.2", name: "GLM-5.2", backend: "vllm" }];
  if (path === "/status") {
    return { running: false, process: null, inference_port: 8000, launching: null };
  }
  if (path === "/compat") return { platform: "cpu", compatible: true };
  if (path === "/gpus") return { gpus: [] };
  if (path === "/v1/metrics/vllm") return {};
  return {};
};

const agentPayload = (path: string) => {
  if (path === "/api/agent/projects") return { projects: [] };
  if (path === "/api/agent/models") return { models: [] };
  if (path === "/api/agent/setup-checks") return { checks: [] };
  if (path === "/api/agent/runtime/sessions") return { sessions: [] };
  if (path === "/api/agent/browser/localhosts") return { localhostUrls: [] };
  return {};
};

const fulfill = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

export async function installProductFixtures(page: Page) {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("local-studio-setup-complete", "true");
  });
  await page.route("**/api/proxy/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/proxy", "");
    return fulfill(route, controllerPayload(path));
  });
  await page.route("**/api/agent/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return fulfill(route, agentPayload(path));
  });
}
