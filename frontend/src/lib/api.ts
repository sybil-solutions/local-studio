/**
 * API client for vLLM Studio Controller
 * Minimal client matching the controller endpoints
 */

import type { Recipe, RecipeWithStatus, HealthResponse, ProcessInfo } from './types';

const API_KEY_STORAGE = 'vllmstudio_api_key';

function getStoredApiKey(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(API_KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

class APIClient {
  private baseUrl: string;
  private useProxy: boolean;

  constructor(baseUrl: string, useProxy = false) {
    this.baseUrl = baseUrl;
    this.useProxy = useProxy;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    // Add auth header
    const storedKey = getStoredApiKey();
    if (storedKey) {
      headers['Authorization'] = `Bearer ${storedKey}`;
    }

    const path = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    const url = this.useProxy ? `${this.baseUrl}/${path}` : `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Request failed' }));
      throw new Error(error.detail || error.error?.message || `HTTP ${response.status}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : (null as unknown as T);
  }

  // Health & Status
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

  // Recipes
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

  // Model lifecycle
  async launch(recipeId: string, force = false): Promise<{ success: boolean; pid?: number; message: string }> {
    return this.request(`/launch/${recipeId}?force=${force}`, { method: 'POST' });
  }

  async evict(force = false): Promise<{ success: boolean; evicted_pid?: number }> {
    return this.request(`/evict?force=${force}`, { method: 'POST' });
  }

  async waitReady(timeout = 300): Promise<{ ready: boolean; elapsed: number; error?: string }> {
    return this.request(`/wait-ready?timeout=${timeout}`);
  }

  // OpenAI models endpoint (proxied to vLLM)
  async getOpenAIModels(): Promise<{ data: Array<{ id: string; root?: string; max_model_len?: number }> }> {
    return this.request('/v1/models');
  }

  // Chat sessions
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

  // MCP
  async getMCPServers(): Promise<Array<{ name: string; command: string; args?: string[]; env?: Record<string, string>; enabled?: boolean }>> {
    return this.request('/mcp/servers');
  }

  async getMCPTools(): Promise<{ tools: Array<{ name: string; description?: string; input_schema?: any; server: string }> }> {
    return this.request('/mcp/tools');
  }

  async callMCPTool(server: string, tool: string, args: Record<string, unknown>): Promise<{ result: any }> {
    return this.request(`/mcp/tools/${server}/${tool}`, { method: 'POST', body: JSON.stringify(args) });
  }

  // Tokenization
  async tokenizeChatCompletions(data: { model: string; messages: unknown[]; tools?: unknown[] }): Promise<{ input_tokens?: number; breakdown?: { messages?: number; tools?: number } }> {
    return this.request('/v1/chat/completions/tokenize', { method: 'POST', body: JSON.stringify(data) });
  }

  async countTextTokens(data: { model: string; text: string }): Promise<{ num_tokens?: number }> {
    return this.request('/v1/tokens/count', { method: 'POST', body: JSON.stringify(data) });
  }

  // Log sessions
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

  // Models discovery
  async getModels(): Promise<{ models: any[] }> {
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

  // Model switching
  async switchModel(recipeId: string, force = true): Promise<any> {
    return this.launch(recipeId, force);
  }

  // MCP management
  async addMCPServer(server: any): Promise<void> {
    return this.request('/mcp/servers', { method: 'POST', body: JSON.stringify(server) });
  }

  async updateMCPServer(name: string, server: any): Promise<void> {
    return this.request(`/mcp/servers/${name}`, { method: 'PUT', body: JSON.stringify(server) });
  }

  async removeMCPServer(name: string): Promise<void> {
    return this.request(`/mcp/servers/${name}`, { method: 'DELETE' });
  }

  // Nav helpers
  async evictModel(force = false): Promise<{ success: boolean }> {
    return this.evict(force);
  }

  async exportRecipes(): Promise<{ content: any }> {
    const { recipes } = await this.getRecipes();
    return { content: { recipes } };
  }

  // Benchmarking
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
}

// Singleton for client-side (uses proxy)
export const api = new APIClient('/api/proxy', true);

// Factory for server-side
export function createServerAPI(backendUrl?: string) {
  return new APIClient(backendUrl || process.env.BACKEND_URL || 'http://localhost:8080');
}

export default api;
