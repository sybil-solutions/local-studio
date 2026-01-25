// CRITICAL
import type { GPU, Recipe, Status, Config, LifetimeMetrics } from './types';

const BASE_URL = process.env.VLLM_STUDIO_URL || 'http://localhost:8080';

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function post<T>(path: string, body?: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchGPUs(): Promise<GPU[]> {
  const data = await get<{ gpus: GPU[] }>('/gpus');
  return data?.gpus || [];
}

export async function fetchRecipes(): Promise<Recipe[]> {
  return (await get<Recipe[]>('/recipes')) || [];
}

interface RawStatus {
  running: boolean;
  launching: unknown;
  process?: { pid: number; backend: string; served_model_name?: string; port: number };
  error?: string;
}

export async function fetchStatus(): Promise<Status> {
  const data = await get<RawStatus>('/status');
  if (!data) return { running: false, launching: false };
  return {
    running: data.running,
    launching: !!data.launching,
    model: data.process?.served_model_name,
    backend: data.process?.backend,
    pid: data.process?.pid,
    port: data.process?.port,
    error: data.error,
  };
}

export async function fetchConfig(): Promise<Config | null> {
  const data = await get<{ config: Config }>('/config');
  return data?.config || null;
}

export async function fetchLifetimeMetrics(): Promise<LifetimeMetrics> {
  const data = await get<Record<string, number>>('/lifetime-metrics');
  return {
    total_tokens: data?.tokens_total || 0,
    total_requests: data?.requests_total || 0,
    total_energy_kwh: data?.energy_kwh || 0,
  };
}

export async function launchRecipe(id: string): Promise<boolean> {
  return (await post(`/launch/${id}`)) !== null;
}

export async function evictModel(): Promise<boolean> {
  return (await post('/evict')) !== null;
}
