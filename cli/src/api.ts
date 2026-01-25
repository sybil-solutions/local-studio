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
  return (await get<GPU[]>('/gpus')) || [];
}

export async function fetchRecipes(): Promise<Recipe[]> {
  return (await get<Recipe[]>('/recipes')) || [];
}

export async function fetchStatus(): Promise<Status> {
  return (await get<Status>('/status')) || { status: 'idle' };
}

export async function fetchConfig(): Promise<Config | null> {
  return get<Config>('/config');
}

export async function fetchLifetimeMetrics(): Promise<LifetimeMetrics> {
  const data = await get<Record<string, number>>('/lifetime-metrics');
  return {
    total_tokens: data?.total_tokens || 0,
    total_requests: data?.total_requests || 0,
    total_energy_kwh: data?.total_energy_kwh || 0,
  };
}

export async function launchRecipe(id: string): Promise<boolean> {
  return (await post(`/launch/${id}`)) !== null;
}

export async function evictModel(): Promise<boolean> {
  return (await post('/evict')) !== null;
}
