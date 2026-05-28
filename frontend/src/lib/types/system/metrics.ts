/**
 * GPU + VRAM + metrics types.
 */

// GPU info
export interface GPU {
  id?: string;
  index: number;
  name: string;
  memory_total: number;
  memory_total_mb?: number;
  memory_used: number;
  memory_used_mb?: number;
  memory_free: number;
  memory_free_mb?: number;
  utilization: number;
  utilization_pct?: number;
  temperature?: number;
  temp_c?: number;
  power_draw?: number; // Watts
  power_limit?: number; // Watts
}

// Metrics
export interface Metrics {
  model_id?: string | null;
  model_path?: string | null;
  served_model_name?: string | null;
  requests_total?: number;
  tokens_total?: number;
  latency_avg?: number;
  throughput?: number;
  gpu_utilization?: number;
  memory_used?: number;
  avg_ttft_ms?: number;
  kv_cache_usage?: number;
  generation_throughput?: number;
  prompt_throughput?: number;
  request_success?: number;
  generation_tokens_total?: number;
  prompt_tokens_total?: number;
  running_requests?: number;
  pending_requests?: number;
  // VRAM (aggregated across GPUs)
  vram_used_gb?: number;
  vram_capacity_gb?: number;
  power_limit_watts?: number;
  // Session averages (since first token this session)
  session_avg_prefill?: number;
  session_avg_generation?: number;
  // Session peaks (best this session) — reset on model switch
  session_peak_prefill?: number;
  session_peak_generation?: number;
  session_peak_prompt_throughput?: number;
  session_peak_generation_throughput?: number;
  session_peak_ttft_ms?: number;
  session_peak_kv_cache_usage?: number;
  session_peak_running_requests?: number;
  session_peak_power_watts?: number;
  session_peak_vram_used_gb?: number;
  session_peak_id?: string | null;
  session_peak_prefill_tps?: number;
  session_peak_generation_tps?: number;
  session_peak_best_ttft_ms?: number;
  best_session_peak_id?: string | null;
  best_session_prefill_tps?: number;
  best_session_generation_tps?: number;
  best_session_ttft_ms?: number;
  // All-time peak metrics (stored best values)
  peak_prefill_tps?: number;
  peak_generation_tps?: number;
  peak_ttft_ms?: number;
  total_tokens?: number;
  total_requests?: number;
  // Lifetime metrics (cumulative across all sessions)
  lifetime_tokens?: number;
  lifetime_prompt_tokens?: number;
  lifetime_completion_tokens?: number;
  lifetime_requests?: number;
  lifetime_energy_wh?: number;
  lifetime_energy_kwh?: number;
  lifetime_uptime_hours?: number;
  kwh_per_million_tokens?: number;
  kwh_per_million_input?: number;
  kwh_per_million_output?: number;
  current_power_watts?: number;
}

// VRAM calculation
export interface VRAMCalculation {
  model_size_gb: number;
  context_memory_gb: number;
  overhead_gb: number;
  total_gb: number;
  fits_in_vram: boolean;
  fits: boolean;
  utilization_percent: number;
  breakdown: {
    model_weights_gb: number;
    kv_cache_gb: number;
    activations_gb: number;
    per_gpu_gb: number;
    total_gb: number;
  };
}

export interface PeakMetrics {
  model_id: string;
  prefill_tps: number | null;
  generation_tps: number | null;
  ttft_ms: number | null;
  best_session_id?: string | null;
  best_session_prefill_tps?: number | null;
  best_session_generation_tps?: number | null;
  best_session_ttft_ms?: number | null;
  total_tokens: number;
  total_requests: number;
}
