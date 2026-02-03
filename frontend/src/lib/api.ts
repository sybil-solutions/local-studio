// CRITICAL
/**
 * API client for vLLM Studio Controller
 * Robust client with retry logic, timeouts, and comprehensive error handling
 */

import type {
  Recipe,
  RecipeWithStatus,
  HealthResponse,
  ProcessInfo,
  ModelInfo,
  StudioModelsRoot,
  ChatSession,
  ChatSessionDetail,
  ChatCompactionResponse,
  StoredMessage,
  AgentFileEntry,
  AgentState,
  LogSession,
  MCPServer,
  MCPTool,
  GPU,
  Metrics,
  VRAMCalculation,
  UsageStats,
  VllmRuntimeConfig,
  VllmRuntimeInfo,
  VllmUpgradeResult,
  ModelDownload,
  StorageInfo,
  ModelRecommendation,
  StudioSettings,
  StudioDiagnostics,
} from "./types";
import { getApiKey } from "./api-key";
import { getStoredBackendUrl } from "./backend-url";

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second base delay

// Sleep helper
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const encodePathSegments = (path: string) =>
  path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

// Check if error is retryable
function isRetryableError(error: unknown, status?: number): boolean {
  if (status && status >= 500) return true; // Server errors
  if (status === 429) return true; // Rate limiting
  if (status === 408) return true; // Request timeout
  if (error instanceof TypeError) return true; // Network errors
  if (error instanceof Error && error.name === "AbortError") return false; // Don't retry aborts
  return false;
}

interface RequestOptions extends RequestInit {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

export interface ChatRunStreamEvent {
  event: string;
  data: Record<string, unknown>;
}

class APIClient {
  private baseUrl: string;
  private useProxy: boolean;

  constructor(baseUrl: string, useProxy = false) {
    this.baseUrl = baseUrl;
    this.useProxy = useProxy;
  }

  private buildUrl(endpoint: string): string {
    const path = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
    return this.useProxy ? `${this.baseUrl}/${path}` : `${this.baseUrl}${endpoint}`;
  }

  private buildHeaders(extraHeaders?: HeadersInit): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const storedBackendUrl = getStoredBackendUrl();
    if (this.useProxy && storedBackendUrl) {
      headers["X-Backend-Url"] = storedBackendUrl;
    }

    const storedKey = getApiKey();
    if (storedKey) {
      headers["Authorization"] = `Bearer ${storedKey}`;
    }

    if (extraHeaders) {
      const merged = new Headers(extraHeaders);
      merged.forEach((value, key) => {
        headers[key] = value;
      });
    }

    return headers;
  }

  private async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const {
      timeout = DEFAULT_TIMEOUT,
      retries = DEFAULT_RETRIES,
      retryDelay = RETRY_DELAY,
      ...fetchOptions
    } = options;

    const headers = this.buildHeaders(fetchOptions.headers);
    const url = this.buildUrl(endpoint);

    let lastError: Error | null = null;
    let lastStatus: number | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          ...fetchOptions,
          headers,
          credentials: "include",
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        lastStatus = response.status;

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({ detail: "Request failed" }));
          const errorMessage =
            errorBody.detail || errorBody.error?.message || `HTTP ${response.status}`;
          lastError = new Error(errorMessage);

          // Only retry on retryable errors
          if (isRetryableError(lastError, response.status) && attempt < retries) {
            const delay = retryDelay * Math.pow(2, attempt); // Exponential backoff
            console.warn(
              `[API] Retry ${attempt + 1}/${retries} for ${endpoint} after ${delay}ms (status: ${response.status})`,
            );
            await sleep(delay);
            continue;
          }

          throw lastError;
        }

        const text = await response.text();
        return text ? JSON.parse(text) : (null as unknown as T);
      } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof Error && error.name === "AbortError") {
          lastError = new Error(`Request timeout after ${timeout}ms`);
        } else if (error instanceof Error) {
          lastError = error;
        } else {
          lastError = new Error(String(error));
        }

        // Only retry on retryable errors
        if (isRetryableError(error, lastStatus) && attempt < retries) {
          const delay = retryDelay * Math.pow(2, attempt);
          console.warn(
            `[API] Retry ${attempt + 1}/${retries} for ${endpoint} after ${delay}ms (${lastError.message})`,
          );
          await sleep(delay);
          continue;
        }

        throw lastError;
      }
    }

    throw lastError || new Error("Request failed after retries");
  }

  private async *parseSseStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): AsyncGenerator<ChatRunStreamEvent> {
    const decoder = new TextDecoder();
    let buffer = "";
    let eventType = "";
    let dataLines: string[] = [];

    const flushEvent = (): ChatRunStreamEvent | null => {
      if (dataLines.length === 0) return null;
      const dataString = dataLines.join("\n");
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(dataString) as Record<string, unknown>;
      } catch {
        data = { raw: dataString };
      }
      const payload = {
        event: eventType || "message",
        data,
      };
      eventType = "";
      dataLines = [];
      return payload;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line) {
          const payload = flushEvent();
          if (payload) {
            yield payload;
          }
          continue;
        }

        if (line.startsWith("event:")) {
          eventType = line.slice(6).trim();
          continue;
        }

        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }
    }

    const finalPayload = flushEvent();
    if (finalPayload) {
      yield finalPayload;
    }
  }

  async streamChatRun(
    sessionId: string,
    payload: {
      content: string;
      message_id?: string;
      model?: string;
      system?: string;
      mcp_enabled?: boolean;
      agent_mode?: boolean;
      deep_research?: boolean;
      thinking_level?: string;
    },
    options: { signal?: AbortSignal } = {},
  ): Promise<{ runId: string | null; stream: AsyncGenerator<ChatRunStreamEvent> }> {
    const endpoint = `/chats/${encodeURIComponent(sessionId)}/turn`;
    const url = this.buildUrl(endpoint);
    const headers = this.buildHeaders({
      Accept: "text/event-stream",
    });

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: options.signal,
      credentials: "include",
    });

    if (!response.ok || !response.body) {
      const errorBody = await response.json().catch(() => ({ detail: "Request failed" }));
      const errorMessage =
        errorBody.detail || errorBody.error?.message || `HTTP ${response.status}`;
      throw new Error(errorMessage);
    }

    const runId = response.headers.get("x-run-id");
    const reader = response.body.getReader();
    return {
      runId,
      stream: this.parseSseStream(reader),
    };
  }

  async getHealth(): Promise<HealthResponse> {
    return this.request("/health");
  }

  async getStatus(): Promise<{
    running: boolean;
    process: ProcessInfo | null;
    inference_port: number;
  }> {
    const data = await this.request<{
      running: boolean;
      process: ProcessInfo | null;
      inference_port: number;
    }>("/status");
    return {
      running: data.running ?? !!data.process,
      process: data.process ?? null,
      inference_port: data.inference_port || 8000,
    };
  }

  async getRecipes(): Promise<{ recipes: RecipeWithStatus[] }> {
    const data = await this.request<RecipeWithStatus[]>("/recipes");
    return { recipes: Array.isArray(data) ? data : [] };
  }

  async getRecipe(id: string): Promise<RecipeWithStatus> {
    return this.request(`/recipes/${id}`);
  }

  async createRecipe(recipe: Recipe): Promise<{ success: boolean; id: string }> {
    return this.request("/recipes", { method: "POST", body: JSON.stringify(recipe) });
  }

  async updateRecipe(id: string, recipe: Recipe): Promise<{ success: boolean; id: string }> {
    return this.request(`/recipes/${id}`, { method: "PUT", body: JSON.stringify(recipe) });
  }

  async deleteRecipe(id: string): Promise<void> {
    return this.request(`/recipes/${id}`, { method: "DELETE" });
  }

  async launch(
    recipeId: string,
    force = false,
  ): Promise<{ success: boolean; pid?: number; message: string }> {
    // Model launches can take several minutes; don't use the default 30s timeout and don't retry.
    return this.request(`/launch/${recipeId}?force=${force}`, {
      method: "POST",
      timeout: 6 * 60 * 1000,
      retries: 0,
    });
  }

  async evict(force = false): Promise<{ success: boolean; evicted_pid?: number }> {
    return this.request(`/evict?force=${force}`, { method: "POST" });
  }

  async waitReady(timeout = 300): Promise<{ ready: boolean; elapsed: number; error?: string }> {
    return this.request(`/wait-ready?timeout=${timeout}`);
  }

  async getOpenAIModels(): Promise<{
    data: Array<{ id: string; root?: string; max_model_len?: number }>;
  }> {
    return this.request("/v1/models");
  }

  async getChatSessions(): Promise<{ sessions: ChatSession[] }> {
    const data = await this.request<ChatSession[]>("/chats");
    return { sessions: Array.isArray(data) ? data : [] };
  }

  async getChatSession(id: string): Promise<{ session: ChatSessionDetail }> {
    return this.request(`/chats/${id}`);
  }

  async createChatSession(data: {
    title?: string;
    model?: string;
    agent_state?: AgentState | null;
  }): Promise<{ session: ChatSessionDetail }> {
    return this.request("/chats", { method: "POST", body: JSON.stringify(data) });
  }

  async updateChatSession(
    id: string,
    data: { title?: string; model?: string; agent_state?: AgentState | null },
  ): Promise<void> {
    return this.request(`/chats/${id}`, { method: "PUT", body: JSON.stringify(data) });
  }

  async deleteChatSession(id: string): Promise<void> {
    return this.request(`/chats/${id}`, { method: "DELETE" });
  }

  async forkChatSession(
    id: string,
    data: { message_id?: string; model?: string; title?: string },
  ): Promise<{ session: ChatSessionDetail }> {
    return this.request(`/chats/${id}/fork`, { method: "POST", body: JSON.stringify(data) });
  }

  async compactChatSession(
    id: string,
    data: {
      model?: string;
      system?: string;
      title?: string;
      preserve_first?: boolean;
      preserve_last?: boolean;
    },
  ): Promise<ChatCompactionResponse> {
    return this.request(`/chats/${id}/compact`, { method: "POST", body: JSON.stringify(data) });
  }

  async addChatMessage(sessionId: string, message: StoredMessage): Promise<StoredMessage> {
    return this.request(`/chats/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify(message),
    });
  }

  async abortChatRun(sessionId: string, runId: string): Promise<{ success: boolean }> {
    try {
      return await this.request(`/chats/${sessionId}/runs/${runId}/abort`, {
        method: "POST",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Run not found") || message.includes("HTTP 404")) {
        return { success: false };
      }
      throw error;
    }
  }

  async getChatUsage(sessionId: string): Promise<{
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    estimated_cost_usd?: number;
  }> {
    return this.request(`/chats/${sessionId}/usage`);
  }

  async getAgentFiles(
    sessionId: string,
    options?: { path?: string; recursive?: boolean },
  ): Promise<{ files: AgentFileEntry[]; path?: string }> {
    const params = new URLSearchParams();
    if (options?.path) {
      params.set("path", options.path);
    }
    if (options?.recursive === false) {
      params.set("recursive", "false");
    }
    const query = params.toString();
    return this.request(`/chats/${sessionId}/files${query ? `?${query}` : ""}`);
  }

  async readAgentFile(sessionId: string, path: string): Promise<{ path: string; content: string }> {
    const encoded = encodePathSegments(path);
    return this.request(`/chats/${sessionId}/files/${encoded}`);
  }

  async writeAgentFile(
    sessionId: string,
    path: string,
    data: { content: string; encoding?: "utf8" | "base64" },
  ): Promise<{ success: boolean }> {
    if (!path || path.trim() === "") {
      throw new Error("Path is required");
    }
    const encoded = encodePathSegments(path);
    return this.request(`/chats/${sessionId}/files/${encoded}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteAgentFile(sessionId: string, path: string): Promise<{ success: boolean }> {
    const encoded = encodePathSegments(path);
    return this.request(`/chats/${sessionId}/files/${encoded}`, { method: "DELETE" });
  }

  async createAgentDirectory(sessionId: string, path: string): Promise<{ success: boolean }> {
    return this.request(`/chats/${sessionId}/files/dir`, {
      method: "POST",
      body: JSON.stringify({ path }),
    });
  }

  async moveAgentFile(
    sessionId: string,
    from: string,
    to: string,
  ): Promise<{ success: boolean }> {
    return this.request(`/chats/${sessionId}/files/move`, {
      method: "POST",
      body: JSON.stringify({ from, to }),
    });
  }

  async getMCPServers(): Promise<{ servers: MCPServer[] }> {
    const data = await this.request<MCPServer[] | { servers?: MCPServer[] }>("/mcp/servers");
    const servers = Array.isArray(data) ? data : (data?.servers ?? []);
    return { servers };
  }

  async getMCPTools(): Promise<{
    tools: MCPTool[];
    errors?: Array<{ server: string; error: string }>;
  }> {
    const data = await this.request<{
      tools?: Array<{
        name: string;
        description?: string;
        input_schema?: unknown;
        inputSchema?: unknown;
        server: string;
      }>;
      errors?: Array<{ server: string; error: string }>;
    }>("/mcp/tools");
    const tools = Array.isArray(data?.tools)
      ? data.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          server: tool.server,
          inputSchema: (tool.inputSchema ?? tool.input_schema) as
            | Record<string, unknown>
            | undefined,
        }))
      : [];
    return { tools, errors: data?.errors ?? undefined };
  }

  async getMCPServerTools(serverId: string): Promise<{ tools: MCPTool[] }> {
    const data = await this.request<{
      tools?: Array<{
        name: string;
        description?: string;
        input_schema?: unknown;
        inputSchema?: unknown;
        server?: string;
      }>;
    }>(`/mcp/servers/${serverId}/tools`);
    const tools = Array.isArray(data?.tools)
      ? data.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          server: tool.server || serverId,
          inputSchema: (tool.inputSchema ?? tool.input_schema) as
            | Record<string, unknown>
            | undefined,
        }))
      : [];
    return { tools };
  }

  async callMCPTool(
    server: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<{ result: unknown }> {
    return this.request(`/mcp/tools/${server}/${tool}`, {
      method: "POST",
      body: JSON.stringify(args),
    });
  }

  async tokenizeChatCompletions(data: {
    model: string;
    messages: unknown[];
    tools?: unknown[];
  }): Promise<{ input_tokens?: number; breakdown?: { messages?: number; tools?: number } }> {
    return this.request("/v1/tokenize-chat-completions", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async countTextTokens(data: { model: string; text: string }): Promise<{ num_tokens?: number }> {
    return this.request("/v1/tokens/count", { method: "POST", body: JSON.stringify(data) });
  }

  async getLogSessions(): Promise<{ sessions: LogSession[] }> {
    return this.request("/logs");
  }

  async getLogs(sessionId: string, limit?: number): Promise<{ logs: string[] }> {
    const query = limit ? `?limit=${limit}` : "";
    return this.request(`/logs/${sessionId}${query}`);
  }

  async getLogContent(sessionId: string, limit?: number): Promise<{ content: string }> {
    const query = limit ? `?limit=${limit}` : "";
    return this.request(`/logs/${sessionId}${query}`);
  }

  async deleteLogSession(sessionId: string): Promise<void> {
    return this.request(`/logs/${sessionId}`, { method: "DELETE" });
  }

  async getModels(): Promise<{
    models: ModelInfo[];
    roots?: StudioModelsRoot[];
    configured_models_dir?: string;
  }> {
    return this.request("/v1/studio/models");
  }

  async getStudioSettings(): Promise<StudioSettings> {
    return this.request("/studio/settings");
  }

  async updateStudioSettings(modelsDir: string): Promise<StudioSettings & { success: boolean }> {
    return this.request("/studio/settings", {
      method: "POST",
      body: JSON.stringify({ models_dir: modelsDir }),
    });
  }

  async getStudioDiagnostics(): Promise<StudioDiagnostics> {
    return this.request("/studio/diagnostics");
  }

  async getStudioStorage(): Promise<StorageInfo> {
    return this.request("/studio/storage");
  }

  async getModelRecommendations(): Promise<{ recommendations: ModelRecommendation[]; max_vram_gb: number }> {
    return this.request("/studio/recommendations");
  }

  async getDownloads(): Promise<{ downloads: ModelDownload[] }> {
    return this.request("/studio/downloads");
  }

  async startDownload(params: {
    model_id: string;
    revision?: string;
    destination_dir?: string;
    allow_patterns?: string[];
    ignore_patterns?: string[];
    hf_token?: string;
  }): Promise<{ download: ModelDownload }> {
    return this.request("/studio/downloads", { method: "POST", body: JSON.stringify(params) });
  }

  async pauseDownload(id: string): Promise<{ download: ModelDownload }> {
    return this.request(`/studio/downloads/${encodePathSegments(id)}/pause`, { method: "POST" });
  }

  async resumeDownload(id: string, hfToken?: string): Promise<{ download: ModelDownload }> {
    return this.request(`/studio/downloads/${encodePathSegments(id)}/resume`, {
      method: "POST",
      body: hfToken ? JSON.stringify({ hf_token: hfToken }) : "{}",
    });
  }

  async cancelDownload(id: string): Promise<{ download: ModelDownload }> {
    return this.request(`/studio/downloads/${encodePathSegments(id)}/cancel`, { method: "POST" });
  }

  async deleteModel(path: string): Promise<{ success: boolean }> {
    return this.request("/studio/models/delete", { method: "POST", body: JSON.stringify({ path }) });
  }

  async moveModel(sourcePath: string, targetRoot: string): Promise<{ success: boolean; target: string }> {
    return this.request("/studio/models/move", {
      method: "POST",
      body: JSON.stringify({ source_path: sourcePath, target_root: targetRoot }),
    });
  }

  async getGPUs(): Promise<{ gpus: GPU[] }> {
    return this.request("/gpus");
  }

  async calculateVRAM(data: {
    model: string;
    context_length: number;
    tp_size: number;
    kv_dtype: string;
  }): Promise<VRAMCalculation> {
    return this.request("/vram-calculator", { method: "POST", body: JSON.stringify(data) });
  }

  async getMetrics(): Promise<Metrics> {
    return this.request("/v1/metrics/vllm");
  }

  async switchModel(
    recipeId: string,
    force = true,
  ): Promise<{ success: boolean; pid?: number; message: string }> {
    return this.launch(recipeId, force);
  }

  async addMCPServer(server: unknown): Promise<void> {
    return this.request("/mcp/servers", { method: "POST", body: JSON.stringify(server) });
  }

  async updateMCPServer(serverId: string, server: unknown): Promise<void> {
    return this.request(`/mcp/servers/${serverId}`, { method: "PUT", body: JSON.stringify(server) });
  }

  async removeMCPServer(serverId: string): Promise<void> {
    return this.request(`/mcp/servers/${serverId}`, { method: "DELETE" });
  }

  async evictModel(force = false): Promise<{ success: boolean }> {
    return this.evict(force);
  }

  async exportRecipes(): Promise<{ content: unknown }> {
    const { recipes } = await this.getRecipes();
    return { content: { recipes } };
  }

  async runBenchmark(
    promptTokens = 1000,
    maxTokens = 100,
  ): Promise<{
    success?: boolean;
    error?: string;
    model_id?: string;
    benchmark?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_time_s: number;
      prefill_tps: number;
      generation_tps: number;
      ttft_ms: number;
    };
    peak_metrics?: {
      prefill_tps: number;
      generation_tps: number;
      ttft_ms: number;
      total_tokens: number;
      total_requests: number;
    };
  }> {
    return this.request(`/benchmark?prompt_tokens=${promptTokens}&max_tokens=${maxTokens}`, {
      method: "POST",
    });
  }

  async getPeakMetrics(modelId?: string): Promise<{
    metrics?: Array<{
      model_id: string;
      prefill_tps: number;
      generation_tps: number;
      ttft_ms: number;
      total_tokens: number;
      total_requests: number;
    }>;
    error?: string;
  }> {
    const query = modelId ? `?model_id=${modelId}` : "";
    return this.request(`/peak-metrics${query}`);
  }

  // Usage Analytics
  async getUsageStats(): Promise<UsageStats> {
    return this.request("/usage");
  }

  async getSystemConfig(): Promise<{
    config: {
      host: string;
      port: number;
      inference_port: number;
      api_key_configured: boolean;
      models_dir: string;
      data_dir: string;
      db_path: string;
      sglang_python: string | null;
      tabby_api_dir: string | null;
    };
    services: Array<{
      name: string;
      port: number;
      internal_port: number;
      protocol: string;
      status: string;
      description: string | null;
    }>;
    environment: {
      controller_url: string;
      inference_url: string;
      litellm_url: string;
      frontend_url: string;
    };
  }> {
    return this.request("/config");
  }

  async getVllmRuntime(): Promise<VllmRuntimeInfo> {
    return this.request("/runtime/vllm");
  }

  async getVllmRuntimeConfig(): Promise<VllmRuntimeConfig> {
    return this.request("/runtime/vllm/config");
  }

  async upgradeVllmRuntime(preferBundled = true): Promise<VllmUpgradeResult> {
    return this.request("/runtime/vllm/upgrade", {
      method: "POST",
      body: JSON.stringify({ prefer_bundled: preferBundled }),
    });
  }
}

// For client-side calls, use the proxy which handles authentication
// The proxy adds the API key server-side, avoiding CORS and auth issues
const isClient = typeof window !== "undefined";
const clientBaseUrl = isClient
  ? "/api/proxy"
  : process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    process.env.VLLM_STUDIO_BACKEND_URL ||
    "http://localhost:8080";

export const api = new APIClient(clientBaseUrl, isClient);

export default api;
