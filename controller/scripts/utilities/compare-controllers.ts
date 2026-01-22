/**
 * Canary comparison harness for controller endpoints.
 */

import { existsSync, unlinkSync, writeFileSync } from "node:fs";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

/**
 * Response snapshot for comparison.
 */
interface Snapshot {
  status: number;
  contentType: string | null;
  body: unknown;
}

/**
 * Build a shape signature for a JSON payload.
 * @param value - Response body.
 * @returns Shape signature string.
 */
const shapeSignature = (value: unknown): string => {
  if (Array.isArray(value)) {
    const first = value[0];
    const elementShape = first ? shapeSignature(first) : "empty";
    return `array:${value.length}:${elementShape}`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `object:${keys.join(",")}`;
  }
  return typeof value;
};
/**
 * Fetch and parse a response as JSON or text.
 * @param url - URL to fetch.
 * @param method - HTTP method.
 * @param body - Optional request body.
 * @param timeoutMs - Timeout in milliseconds.
 * @returns Snapshot of response.
 */
const fetchSnapshot = async (
  url: string,
  method: HttpMethod,
  body?: unknown,
  timeoutMs = 10_000,
): Promise<Snapshot> => {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const contentType = response.headers.get("content-type");
    let payload: unknown = null;
    if (contentType && contentType.includes("application/json")) {
      payload = await response.json();
    } else {
      payload = await response.text();
    }
    return { status: response.status, contentType, body: payload };
  } catch (error) {
    return { status: 0, contentType: null, body: String(error) };
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Fetch a streaming response without consuming the body.
 * @param url - URL to fetch.
 * @param method - HTTP method.
 * @param body - Optional request body.
 * @param timeoutMs - Timeout in milliseconds.
 * @returns Snapshot of response metadata.
 */
const fetchStreamSnapshot = async (
  url: string,
  method: HttpMethod,
  body?: unknown,
  timeoutMs = 10_000,
): Promise<Snapshot> => {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const contentType = response.headers.get("content-type");
    if (response.body) {
      await response.body.cancel();
    }
    return { status: response.status, contentType, body: null };
  } catch (error) {
    return { status: 0, contentType: null, body: String(error) };
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Compare two snapshots.
 * @param left - Left snapshot.
 * @param right - Right snapshot.
 * @returns True if comparable.
 */
const compareSnapshots = (left: Snapshot, right: Snapshot): boolean => {
  if (left.status !== right.status) {
    return false;
  }
  const leftShape = shapeSignature(left.body);
  const rightShape = shapeSignature(right.body);
  return leftShape === rightShape;
};

/**
 * Compare two streaming snapshots.
 * @param left - Left snapshot.
 * @param right - Right snapshot.
 * @returns True if comparable.
 */
const compareStreamSnapshots = (left: Snapshot, right: Snapshot): boolean => {
  if (left.status !== right.status) {
    return false;
  }
  const normalizeContentType = (contentType: string | null): string =>
    contentType?.split(";")[0]?.trim() ?? "";
  return normalizeContentType(left.contentType) === normalizeContentType(right.contentType);
};

/**
 * Execute and compare a request against both controllers.
 * @param name - Check name.
 * @param method - HTTP method.
 * @param path - Endpoint path.
 * @param body - Optional body.
 * @param baseOld - Old controller URL.
 * @param baseNew - New controller URL.
 * @param beforeNew - Optional hook before new request.
 * @returns Comparison result.
 */
const compareEndpoint = async (
  name: string,
  method: HttpMethod,
  path: string,
  body: unknown | undefined,
  baseOld: string,
  baseNew: string,
  beforeNew?: () => Promise<void>,
): Promise<{ name: string; ok: boolean; old: Snapshot; next: Snapshot }> => {
  const oldSnapshot = await fetchSnapshot(`${baseOld}${path}`, method, body);
  if (beforeNew) {
    await beforeNew();
  }
  const newSnapshot = await fetchSnapshot(`${baseNew}${path}`, method, body);
  return {
    name,
    ok: compareSnapshots(oldSnapshot, newSnapshot),
    old: oldSnapshot,
    next: newSnapshot,
  };
};

/**
 * Execute and compare a streaming request against both controllers.
 * @param name - Check name.
 * @param method - HTTP method.
 * @param path - Endpoint path.
 * @param body - Optional body.
 * @param baseOld - Old controller URL.
 * @param baseNew - New controller URL.
 * @param beforeNew - Optional hook before new request.
 * @returns Comparison result.
 */
const compareStreamEndpoint = async (
  name: string,
  method: HttpMethod,
  path: string,
  body: unknown | undefined,
  baseOld: string,
  baseNew: string,
  beforeNew?: () => Promise<void>,
): Promise<{ name: string; ok: boolean; old: Snapshot; next: Snapshot }> => {
  const oldSnapshot = await fetchStreamSnapshot(`${baseOld}${path}`, method, body);
  if (beforeNew) {
    await beforeNew();
  }
  const newSnapshot = await fetchStreamSnapshot(`${baseNew}${path}`, method, body);
  return {
    name,
    ok: compareStreamSnapshots(oldSnapshot, newSnapshot),
    old: oldSnapshot,
    next: newSnapshot,
  };
};

/**
 * Run the comparison harness.
 * @returns Promise that resolves after reporting.
 */
const run = async (): Promise<void> => {
  const baseOld = process.env["CONTROLLER_OLD_URL"] ?? "http://localhost:8080";
  const baseNew = process.env["CONTROLLER_NEW_URL"] ?? "http://localhost:8002";
  const results: Array<{ name: string; ok: boolean; old: Snapshot; next: Snapshot }> = [];

  results.push(await compareEndpoint("GET /health", "GET", "/health", undefined, baseOld, baseNew));
  results.push(await compareEndpoint("GET /status", "GET", "/status", undefined, baseOld, baseNew));
  results.push(await compareEndpoint("GET /gpus", "GET", "/gpus", undefined, baseOld, baseNew));
  results.push(await compareEndpoint("GET /config", "GET", "/config", undefined, baseOld, baseNew));
  const recipeId = `canary-${Date.now()}`;
  const recipePayload = {
    id: recipeId,
    name: "Canary Recipe",
    model_path: "/models/canary",
    backend: "vllm",
  };

  results.push(await compareEndpoint("POST /recipes", "POST", "/recipes", recipePayload, baseOld, baseNew));
  results.push(await compareEndpoint("GET /recipes/:id", "GET", `/recipes/${recipeId}`, undefined, baseOld, baseNew));
  results.push(await compareEndpoint("GET /recipes", "GET", "/recipes", undefined, baseOld, baseNew));
  const updatedRecipe = { ...recipePayload, name: "Canary Recipe Updated" };
  results.push(await compareEndpoint("PUT /recipes/:id", "PUT", `/recipes/${recipeId}`, updatedRecipe, baseOld, baseNew));
  results.push(await compareEndpoint("POST /launch/:id", "POST", `/launch/${recipeId}`, undefined, baseOld, baseNew));
  results.push(await compareEndpoint("POST /launch/:id/cancel", "POST", `/launch/${recipeId}/cancel`, undefined, baseOld, baseNew));
  results.push(await compareEndpoint("POST /evict", "POST", "/evict", undefined, baseOld, baseNew));
  results.push(await compareEndpoint("GET /wait-ready", "GET", "/wait-ready", undefined, baseOld, baseNew));

  const logSessionId = `canary-log-${Date.now()}`;
  const isSnap = Boolean(process.env["SNAP"]);
  const oldLogSessionId = process.env["CANARY_LOG_SESSION_OLD"] ?? (isSnap ? logSessionId : `${logSessionId}-old`);
  const newLogSessionId = process.env["CANARY_LOG_SESSION_NEW"] ?? (isSnap ? logSessionId : `${logSessionId}-new`);
  const oldLogPath = `/tmp/vllm_${oldLogSessionId}.log`;
  const logPath = `/tmp/vllm_${newLogSessionId}.log`;
  if (!isSnap) {
    writeFileSync(oldLogPath, "canary log line\n", "utf-8");
  }
  writeFileSync(logPath, "canary log line\n", "utf-8");

  results.push(await compareEndpoint("GET /logs", "GET", "/logs", undefined, baseOld, baseNew));
  const oldLogSnapshot = await fetchSnapshot(`${baseOld}/logs/${oldLogSessionId}`, "GET");
  const newLogSnapshot = await fetchSnapshot(`${baseNew}/logs/${newLogSessionId}`, "GET");
  results.push({
    name: "GET /logs/:id",
    ok: compareSnapshots(oldLogSnapshot, newLogSnapshot),
    old: oldLogSnapshot,
    next: newLogSnapshot,
  });
  const oldLogStream = await fetchStreamSnapshot(`${baseOld}/logs/${oldLogSessionId}/stream`, "GET");
  const newLogStream = await fetchStreamSnapshot(`${baseNew}/logs/${newLogSessionId}/stream`, "GET");
  results.push({
    name: "GET /logs/:id/stream",
    ok: compareStreamSnapshots(oldLogStream, newLogStream),
    old: oldLogStream,
    next: newLogStream,
  });
  const deleteOldLog = await fetchSnapshot(`${baseOld}/logs/${oldLogSessionId}`, "DELETE");
  const deleteNewLog = await fetchSnapshot(`${baseNew}/logs/${newLogSessionId}`, "DELETE");
  results.push({
    name: "DELETE /logs/:id",
    ok: compareSnapshots(deleteOldLog, deleteNewLog),
    old: deleteOldLog,
    next: deleteNewLog,
  });
  results.push(await compareStreamEndpoint("GET /events", "GET", "/events", undefined, baseOld, baseNew));
  results.push(await compareEndpoint("GET /events/stats", "GET", "/events/stats", undefined, baseOld, baseNew));

  results.push(await compareEndpoint("GET /metrics", "GET", "/metrics", undefined, baseOld, baseNew));
  results.push(await compareEndpoint("GET /peak-metrics", "GET", "/peak-metrics", undefined, baseOld, baseNew));
  results.push(await compareEndpoint("GET /lifetime-metrics", "GET", "/lifetime-metrics", undefined, baseOld, baseNew));
  results.push(await compareEndpoint("POST /benchmark", "POST", "/benchmark", undefined, baseOld, baseNew));
  results.push(await compareEndpoint("GET /usage", "GET", "/usage", undefined, baseOld, baseNew));

  results.push(await compareEndpoint("GET /v1/models", "GET", "/v1/models", undefined, baseOld, baseNew));
  results.push(await compareEndpoint("GET /v1/models/:id", "GET", `/v1/models/${recipeId}`, undefined, baseOld, baseNew));
  results.push(await compareEndpoint("GET /v1/studio/models", "GET", "/v1/studio/models", undefined, baseOld, baseNew));
  results.push(await compareEndpoint("GET /v1/huggingface/models", "GET", "/v1/huggingface/models", undefined, baseOld, baseNew));

  const chatCreate = await fetchSnapshot(`${baseOld}/chats`, "POST", { title: "Canary Chat", model: "default" });
  const chatSession = (chatCreate.body as Record<string, unknown>)?.["session"] as Record<string, unknown> | undefined;
  const sessionId = chatSession && typeof chatSession["id"] === "string" ? String(chatSession["id"]) : `canary-chat-${Date.now()}`;
  results.push(await compareEndpoint("POST /chats", "POST", "/chats", { title: "Canary Chat", model: "default" }, baseOld, baseNew));

  results.push(await compareEndpoint("GET /chats", "GET", "/chats", undefined, baseOld, baseNew));
  results.push(await compareEndpoint("GET /chats/:id", "GET", `/chats/${sessionId}`, undefined, baseOld, baseNew));
  results.push(await compareEndpoint("PUT /chats/:id", "PUT", `/chats/${sessionId}`, {
    title: "Canary Chat Updated",
    model: "default",
  }, baseOld, baseNew));
  results.push(await compareEndpoint("POST /chats/:id/messages", "POST", `/chats/${sessionId}/messages`, {
    id: `msg-${Date.now()}`,
    role: "user",
    content: "Hello",
  }, baseOld, baseNew));
  results.push(await compareEndpoint("GET /chats/:id/usage", "GET", `/chats/${sessionId}/usage`, undefined, baseOld, baseNew));
  results.push(await compareEndpoint("POST /chats/:id/fork", "POST", `/chats/${sessionId}/fork`, {}, baseOld, baseNew));
  const deleteOldSession = await fetchSnapshot(`${baseOld}/chats`, "POST", { title: "Canary Delete Chat", model: "default" });
  const deleteNewSession = await fetchSnapshot(`${baseNew}/chats`, "POST", { title: "Canary Delete Chat", model: "default" });
  const deleteOldPayload = deleteOldSession.body as Record<string, unknown>;
  const deleteNewPayload = deleteNewSession.body as Record<string, unknown>;
  const deleteOldId = typeof (deleteOldPayload["session"] as Record<string, unknown> | undefined)?.["id"] === "string"
    ? String((deleteOldPayload["session"] as Record<string, unknown>)["id"])
    : `canary-delete-old-${Date.now()}`;
  const deleteNewId = typeof (deleteNewPayload["session"] as Record<string, unknown> | undefined)?.["id"] === "string"
    ? String((deleteNewPayload["session"] as Record<string, unknown>)["id"])
    : `canary-delete-new-${Date.now()}`;
  const deleteOldSnapshot = await fetchSnapshot(`${baseOld}/chats/${deleteOldId}`, "DELETE");
  const deleteNewSnapshot = await fetchSnapshot(`${baseNew}/chats/${deleteNewId}`, "DELETE");
  results.push({
    name: "DELETE /chats/:id",
    ok: compareSnapshots(deleteOldSnapshot, deleteNewSnapshot),
    old: deleteOldSnapshot,
    next: deleteNewSnapshot,
  });

  const mcpServerId = `canary-mcp-${Date.now()}`;
  const mcpServerPayload = {
    id: mcpServerId,
    name: "Canary MCP",
    enabled: true,
    command: "npx",
    args: ["-y", "exa-mcp-server"],
    env: {},
    description: "Canary MCP server",
    url: "https://example.com",
  };

  results.push(await compareEndpoint("POST /mcp/servers", "POST", "/mcp/servers", mcpServerPayload, baseOld, baseNew));
  results.push(await compareEndpoint("GET /mcp/servers/:id", "GET", `/mcp/servers/${mcpServerId}`, undefined, baseOld, baseNew));
  results.push(await compareEndpoint("PUT /mcp/servers/:id", "PUT", `/mcp/servers/${mcpServerId}`, {
    name: "Canary MCP Updated",
  }, baseOld, baseNew));
  results.push(await compareEndpoint("POST /mcp/servers/:id/disable", "POST", `/mcp/servers/${mcpServerId}/disable`, undefined, baseOld, baseNew));
  results.push(await compareEndpoint("POST /mcp/servers/:id/enable", "POST", `/mcp/servers/${mcpServerId}/enable`, undefined, baseOld, baseNew));
  results.push(await compareEndpoint(
    "DELETE /mcp/servers/:id",
    "DELETE",
    `/mcp/servers/${mcpServerId}`,
    undefined,
    baseOld,
    baseNew,
    async () => {
      await fetchSnapshot(`${baseOld}/mcp/servers`, "POST", mcpServerPayload);
    },
  ));

  results.push(await compareEndpoint("GET /mcp/servers", "GET", "/mcp/servers", undefined, baseOld, baseNew));
  results.push(await compareEndpoint("GET /mcp/tools", "GET", "/mcp/tools", undefined, baseOld, baseNew));
  results.push(await compareEndpoint("GET /mcp/servers/exa", "GET", "/mcp/servers/exa", undefined, baseOld, baseNew));
  results.push(await compareEndpoint("GET /mcp/servers/exa/tools", "GET", "/mcp/servers/exa/tools", undefined, baseOld, baseNew));

  results.push(await compareEndpoint("POST /v1/tokenize", "POST", "/v1/tokenize", { model: "default", prompt: "hi" }, baseOld, baseNew));
  results.push(await compareEndpoint("POST /v1/detokenize", "POST", "/v1/detokenize", { model: "default", tokens: [1, 2] }, baseOld, baseNew));
  results.push(await compareEndpoint("POST /v1/count-tokens", "POST", "/v1/count-tokens", { model: "default", text: "hello" }, baseOld, baseNew));
  results.push(await compareEndpoint("POST /v1/tokenize-chat-completions", "POST", "/v1/tokenize-chat-completions", { model: "default", messages: [{ role: "user", content: "hello" }] }, baseOld, baseNew));
  results.push(await compareEndpoint("POST /v1/chat/completions", "POST", "/v1/chat/completions", {
    model: "default",
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 1,
    stream: false,
  }, baseOld, baseNew));
  results.push(await compareEndpoint("POST /api/title", "POST", "/api/title", { model: "default", user: "Hello", assistant: "World" }, baseOld, baseNew));

  results.push(await compareEndpoint(
    "DELETE /recipes/:id",
    "DELETE",
    `/recipes/${recipeId}`,
    undefined,
    baseOld,
    baseNew,
    async () => {
      await fetchSnapshot(`${baseOld}/recipes`, "POST", recipePayload);
    },
  ));

  if (existsSync(logPath)) {
    unlinkSync(logPath);
  }
  if (!isSnap && oldLogPath !== logPath && existsSync(oldLogPath)) {
    unlinkSync(oldLogPath);
  }

  const lines = results.map((result) => {
    const marker = result.ok ? "✅" : "⚠️";
    const oldShape = shapeSignature(result.old.body);
    const newShape = shapeSignature(result.next.body);
    return `${marker} ${result.name} | old:${result.old.status}/${oldShape} new:${result.next.status}/${newShape}`;
  });

  console.log(lines.join("\n"));
  process.exit(0);
};

void run();
