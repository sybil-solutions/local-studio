export interface ControllerUsageStats {
  totals: {
    total_requests: number;
    successful_requests: number;
    failed_requests: number;
    success_rate: number;
  };
  latency: {
    avg_ms: number | null;
    max_ms: number | null;
  };
  recent_activity: {
    last_hour_requests: number;
    last_24h_requests: number;
    last_24h_failed_requests: number;
  };
  by_path: Array<{
    method: string;
    path: string;
    requests: number;
    successful: number;
    failed: number;
    success_rate: number;
    avg_duration_ms: number | null;
    max_duration_ms: number | null;
  }>;
  by_status: Array<{
    status: number;
    requests: number;
  }>;
  recent_errors: Array<{
    method: string;
    path: string;
    status: number;
    error_class: string | null;
    error_message: string | null;
    created_at: string;
  }>;
  function_calls?: {
    totals: {
      total_calls: number;
      successful_calls: number;
      failed_calls: number;
      success_rate: number;
    };
    latency: {
      avg_ms: number | null;
      max_ms: number | null;
    };
    by_function: Array<{
      function_name: string;
      calls: number;
      successful: number;
      failed: number;
      success_rate: number;
      avg_duration_ms: number | null;
      max_duration_ms: number | null;
    }>;
    recent_errors: Array<{
      function_name: string;
      error_class: string | null;
      error_message: string | null;
      created_at: string;
    }>;
  };
}

export interface UsageStats {
  totals: {
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_requests: number;
    successful_requests: number;
    failed_requests: number;
    success_rate: number;
    unique_sessions: number;
    unique_users: number;
  };
  latency: {
    avg_ms: number | null;
    p50_ms: number | null;
    p95_ms: number | null;
    p99_ms: number | null;
    min_ms: number | null;
    max_ms: number | null;
  };
  ttft: {
    avg_ms: number | null;
    p50_ms: number | null;
    p95_ms: number | null;
    p99_ms: number | null;
  };
  tokens_per_request: {
    avg: number;
    avg_prompt: number;
    avg_completion: number;
    max: number;
    p50: number;
    p95: number;
  };
  cache: {
    hits: number;
    misses: number;
    hit_tokens: number;
    miss_tokens: number;
    hit_rate: number;
  };
  week_over_week: {
    this_week: {
      requests: number;
      tokens: number;
      successful: number;
    };
    last_week: {
      requests: number;
      tokens: number;
      successful: number;
    };
    change_pct: {
      requests: number | null;
      tokens: number | null;
    };
  };
  recent_activity: {
    last_hour_requests: number;
    last_24h_requests: number;
    prev_24h_requests: number;
    last_24h_tokens: number;
    change_24h_pct: number | null;
  };
  peak_days: Array<{
    date: string;
    requests: number;
    tokens: number;
  }>;
  peak_hours: Array<{
    hour: number;
    requests: number;
  }>;
  by_model: Array<{
    model: string;
    requests: number;
    successful: number;
    success_rate: number;
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    avg_tokens: number;
    avg_latency_ms: number | null;
    p50_latency_ms: number | null;
    avg_ttft_ms: number | null;
    tokens_per_sec: number | null;
    prefill_tps: number | null;
    generation_tps: number | null;
  }>;
  daily: Array<{
    date: string;
    requests: number;
    successful: number;
    success_rate: number;
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    avg_latency_ms: number;
  }>;
  daily_by_model?: Array<{
    date: string;
    model: string;
    requests: number;
    successful: number;
    success_rate: number;
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
  }>;
  hourly_pattern: Array<{
    hour: number;
    requests: number;
    successful: number;
    tokens: number;
  }>;
  controller?: ControllerUsageStats;
}

export type SortField = "model" | "requests" | "tokens" | "success" | "latency" | "ttft" | "speed";
export type SortDirection = "asc" | "desc";
