/**
 * API client for vLLM Studio Controller
 * Robust client with retry logic, timeouts, and comprehensive error handling
 */

import type { Recipe, RecipeWithStatus, HealthResponse, ProcessInfo, ModelInfo, StudioModelsRoot } from './types';

const API_KEY_STORAGE = 'vllmstudio_api_key';
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second base delay

function getStoredApiKey(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(API_KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

// Sleep helper
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Check if error is retryable
function isRetryableError(error: unknown, status?: number): boolean {
  if (status && status >= 500) return true; // Server errors
  if (status === 429) return true; // Rate limiting
  if (status === 408) return true; // Request timeout
  if (error instanceof TypeError) return true; // Network errors
  if (error instanceof Error && error.name === 'AbortError') return false; // Don't retry aborts
  return false;
}

interface RequestOptions extends RequestInit {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

class APIClient {
  private baseUrl: string;
  private useProxy: boolean;

  constructor(baseUrl: string, useProxy = false) {
    this.baseUrl = baseUrl;
    this.useProxy = useProxy;
  }

  private async request<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const {
      timeout = DEFAULT_TIMEOUT,
      retries = DEFAULT_RETRIES,
      retryDelay = RETRY_DELAY,
      ...fetchOptions
    } = options;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    const storedKey = getStoredApiKey();
    if (storedKey) {
      headers['Authorization'] = `Bearer ${storedKey}`;
    }

    const path = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    const url = this.useProxy ? `${this.baseUrl}/${path}` : `${this.baseUrl}${endpoint}`;

    let lastError: Error | null = null;
    let lastStatus: number | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          ...fetchOptions,
          headers: { ...headers, ...fetchOptions.headers },
          credentials: 'include',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        lastStatus = response.status;

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({ detail: 'Request failed' }));
          const errorMessage = errorBody.detail || errorBody.error?.message || `HTTP ${response.status}`;
          lastError = new Error(errorMessage);

          // Only retry on retryable errors
          if (isRetryableError(lastError, response.status) && attempt < retries) {
            const delay = retryDelay * Math.pow(2, attempt); // Exponential backoff
            console.warn(`[API] Retry ${attempt + 1}/${retries} for ${endpoint} after ${delay}ms (status: ${response.status})`);
            await sleep(delay);
            continue;
          }

          throw lastError;
        }

        const text = await response.text();
        return text ? JSON.parse(text) : (null as unknown as T);

      } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof Error && error.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${timeout}ms`);
        } else if (error instanceof Error) {
          lastError = error;
        } else {
          lastError = new Error(String(error));
        }

        // Only retry on retryable errors
        if (isRetryableError(error, lastStatus) && attempt < retries) {
          const delay = retryDelay * Math.pow(2, attempt);
          console.warn(`[API] Retry ${attempt + 1}/${retries} for ${endpoint} after ${delay}ms (${lastError.message})`);
          await sleep(delay);
          continue;
        }

        throw lastError;
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  async getHealth(): Promise<HealthResponse> {
    return this.request('/health');
  }

  async getStatus(): Promise<{ running: boolean; process: ProcessInfo | null; inference_port: number }> {
    const data = await this.request<{ running: boolean; process: ProcessInfo | null; inference_port: number }>('/status');
    return {
      running: data.running ?? !!data.process,
      process: data.process ?? null,
      inference_port: data.inference_port || 8000,
    };
  }

  async getRecipes(): Promise<{ recipes: RecipeWithStatus[] }> {
    const data = await this.request<RecipeWithStatus[]>('/recipes');
    return { recipes: Array.isArray(data) ? data : [] };
  }

  async getRecipe(id: string): Promise<RecipeWithStatus> {
    return this.request(`/recipes/${id}`);
  }

  async createRecipe(recipe: Recipe): Promise<{ success: boolean; id: string }> {
    return this.request('/recipes', { method: 'POST', body: JSON.stringify(recipe) });
  }

  async updateRecipe(id: string, recipe: Recipe): Promise<{ success: boolean; id: string }> {
    return this.request(`/recipes/${id}`, { method: 'PUT', body: JSON.stringify(recipe) });
  }

  async deleteRecipe(id: string): Promise<void> {
    return this.request(`/recipes/${id}`, { method: 'DELETE' });
  }

  async launch(recipeId: string, force = false): Promise<{ success: boolean; pid?: number; message: string }> {
    // Model launches can take several minutes; don't use the default 30s timeout and don't retry.
    return this.request(`/launch/${recipeId}?force=${force}`, { method: 'POST', timeout: 6 * 60 * 1000, retries: 0 });
  }

  async evict(force = false): Promise<{ success: boolean; evicted_pid?: number }> {
    return this.request(`/evict?force=${force}`, { method: 'POST' });
  }

  async waitReady(timeout = 300): Promise<{ ready: boolean; elapsed: number; error?: string }> {
    return this.request(`/wait-ready?timeout=${timeout}`);
  }

  async getOpenAIModels(): Promise<{ data: Array<{ id: string; root?: string; max_model_len?: number }> }> {
    return this.request('/v1/models');
  }

  async getChatSessions(): Promise<{ sessions: Array<{ id: string; title: string; model?: string; created_at: string; updated_at: string }> }> {
    const data = await this.request<Array<{ id: string; title: string; model?: string; created_at: string; updated_at: string }>>('/chats');
    return { sessions: Array.isArray(data) ? data : [] };
  }

  async getChatSession(id: string): Promise<{ session: any }> {
    return this.request(`/chats/${id}`);
  }

  async createChatSession(data: { title?: string; model?: string }): Promise<{ session: any }> {
    return this.request('/chats', { method: 'POST', body: JSON.stringify(data) });
  }

  async updateChatSession(id: string, data: { title?: string; model?: string }): Promise<void> {
    return this.request(`/chats/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  async deleteChatSession(id: string): Promise<void> {
    return this.request(`/chats/${id}`, { method: 'DELETE' });
  }

  async forkChatSession(id: string, data: { message_id?: string; model?: string; title?: string }): Promise<{ session: any }> {
    return this.request(`/chats/${id}/fork`, { method: 'POST', body: JSON.stringify(data) });
  }

  async addChatMessage(sessionId: string, message: any): Promise<any> {
    return this.request(`/chats/${sessionId}/messages`, { method: 'POST', body: JSON.stringify(message) });
  }

  async getChatUsage(sessionId: string): Promise<{ prompt_tokens: number; completion_tokens: number; total_tokens: number; estimated_cost_usd?: number }> {
    return this.request(`/chats/${sessionId}/usage`);
  }

  async getMCPServers(): Promise<Array<{ name: string; command: string; args?: string[]; env?: Record<string, string>; enabled?: boolean }>> {
    return this.request('/mcp/servers');
  }

  async getMCPTools(): Promise<{ tools: Array<{ name: string; description?: string; input_schema?: any; server: string }> }> {
    return this.request('/mcp/tools');
  }

  async callMCPTool(server: string, tool: string, args: Record<string, unknown>): Promise<{ result: any }> {
    return this.request(`/mcp/tools/${server}/${tool}`, { method: 'POST', body: JSON.stringify(args) });
  }

  async tokenizeChatCompletions(data: { model: string; messages: unknown[]; tools?: unknown[] }): Promise<{ input_tokens?: number; breakdown?: { messages?: number; tools?: number } }> {
    return this.request('/v1/chat/completions/tokenize', { method: 'POST', body: JSON.stringify(data) });
  }

  async countTextTokens(data: { model: string; text: string }): Promise<{ num_tokens?: number }> {
    return this.request('/v1/tokens/count', { method: 'POST', body: JSON.stringify(data) });
  }

  async getLogSessions(): Promise<{ sessions: any[] }> {
    return this.request('/logs');
  }

  async getLogContent(sessionId: string, limit?: number): Promise<{ content: string }> {
    const query = limit ? `?limit=${limit}` : '';
    return this.request(`/logs/${sessionId}${query}`);
  }

  async getLogs(sessionId: string, limit?: number): Promise<{ logs: string[] }> {
    const query = limit ? `?limit=${limit}` : '';
    return this.request(`/logs/${sessionId}${query}`);
  }

  async deleteLogSession(sessionId: string): Promise<void> {
    return this.request(`/logs/${sessionId}`, { method: 'DELETE' });
  }

  async getModels(): Promise<{ models: ModelInfo[]; roots?: StudioModelsRoot[]; configured_models_dir?: string }> {
    return this.request('/v1/studio/models');
  }

  async getGPUs(): Promise<{ gpus: any[] }> {
    return this.request('/gpus');
  }

  async calculateVRAM(data: any): Promise<any> {
    return this.request('/vram-calculator', { method: 'POST', body: JSON.stringify(data) });
  }

  async getMetrics(): Promise<any> {
    return this.request('/v1/metrics/vllm');
  }

  async switchModel(recipeId: string, force = true): Promise<any> {
    return this.launch(recipeId, force);
  }

  async addMCPServer(server: any): Promise<void> {
    return this.request('/mcp/servers', { method: 'POST', body: JSON.stringify(server) });
  }

  async updateMCPServer(name: string, server: any): Promise<void> {
    return this.request(`/mcp/servers/${name}`, { method: 'PUT', body: JSON.stringify(server) });
  }

  async removeMCPServer(name: string): Promise<void> {
    return this.request(`/mcp/servers/${name}`, { method: 'DELETE' });
  }

  async evictModel(force = false): Promise<{ success: boolean }> {
    return this.evict(force);
  }

  async exportRecipes(): Promise<{ content: any }> {
    const { recipes } = await this.getRecipes();
    return { content: { recipes } };
  }

  async runBenchmark(promptTokens = 1000, maxTokens = 100): Promise<{
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
    return this.request(`/benchmark?prompt_tokens=${promptTokens}&max_tokens=${maxTokens}`, { method: 'POST' });
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
    const query = modelId ? `?model_id=${modelId}` : '';
    return this.request(`/peak-metrics${query}`);
  }

  // Usage Analytics
  async getUsageStats(): Promise<{
    totals: {
      total_tokens: number;
      prompt_tokens: number;
      completion_tokens: number;
      total_requests: number;
    };
    cache: {
      hits: number;
      misses: number;
      hit_tokens: number;
      miss_tokens: number;
    };
    by_model: Array<{
      model: string;
      total_tokens: number;
      prompt_tokens: number;
      completion_tokens: number;
      requests: number;
    }>;
    daily: Array<{
      date: string;
      total_tokens: number;
      prompt_tokens: number;
      completion_tokens: number;
      requests: number;
    }>;
  }> {
    return this.request('/usage');
  }
}

export const api = new APIClient('/api/proxy', true);

export function createServerAPI(backendUrl?: string) {
  return new APIClient(backendUrl || process.env.BACKEND_URL || 'http://localhost:8080');
}

export default api;
