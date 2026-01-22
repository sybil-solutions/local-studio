import {
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";

/**
 * Metrics registry wrapper.
 */
export interface MetricsRegistry {
  registry: Registry;
  contentType: string;
  getMetrics: () => Promise<string>;
}

/**
 * Controller metrics collection.
 */
export interface ControllerMetrics {
  recordModelSwitch: (recipeId: string, backend: string, durationSeconds: number, success: boolean) => void;
  updateActiveModel: (modelPath?: string | null, backend?: string | null, servedName?: string | null) => void;
  updateGpuMetrics: (gpus: Record<string, unknown>[]) => void;
  updateSseMetrics: (stats: Record<string, unknown>) => void;
}

/**
 * Create a Prometheus metrics registry and helpers.
 * @returns Registry helpers and metric update functions.
 */
export const createMetrics = (): { registry: MetricsRegistry; metrics: ControllerMetrics } => {
  const registry = new Registry();

  const modelSwitchesTotal = new Counter({
    name: "vllm_studio_model_switches_total",
    help: "Total number of model switches",
    labelNames: ["recipe_id", "backend"],
    registers: [registry],
  });

  const modelSwitchDuration = new Histogram({
    name: "vllm_studio_model_switch_duration_seconds",
    help: "Time taken to switch models",
    labelNames: ["recipe_id"],
    buckets: [10, 30, 60, 120, 300, 600],
    registers: [registry],
  });

  const modelLaunchFailures = new Counter({
    name: "vllm_studio_model_launch_failures_total",
    help: "Total number of failed model launches",
    labelNames: ["recipe_id"],
    registers: [registry],
  });

  const activeModelInfo = new Gauge({
    name: "vllm_studio_active_model",
    help: "Currently active model information",
    labelNames: ["model_path", "backend", "served_model_name"],
    registers: [registry],
  });

  const inferenceServerUp = new Gauge({
    name: "vllm_studio_inference_server_up",
    help: "Whether inference server is running (1=up, 0=down)",
    registers: [registry],
  });

  const gpuMemoryUsed = new Gauge({
    name: "vllm_studio_gpu_memory_used_bytes",
    help: "GPU memory used in bytes",
    labelNames: ["gpu_id", "gpu_name"],
    registers: [registry],
  });

  const gpuMemoryTotal = new Gauge({
    name: "vllm_studio_gpu_memory_total_bytes",
    help: "Total GPU memory in bytes",
    labelNames: ["gpu_id", "gpu_name"],
    registers: [registry],
  });

  const gpuUtilization = new Gauge({
    name: "vllm_studio_gpu_utilization_percent",
    help: "GPU utilization percentage",
    labelNames: ["gpu_id", "gpu_name"],
    registers: [registry],
  });

  const gpuTemperature = new Gauge({
    name: "vllm_studio_gpu_temperature_celsius",
    help: "GPU temperature in Celsius",
    labelNames: ["gpu_id", "gpu_name"],
    registers: [registry],
  });

  const sseActiveConnections = new Gauge({
    name: "vllm_studio_sse_active_connections",
    help: "Number of active SSE connections",
    labelNames: ["channel"],
    registers: [registry],
  });

  const sseEventsPublished = new Counter({
    name: "vllm_studio_sse_events_published_total",
    help: "Total SSE events published",
    labelNames: ["event_type"],
    registers: [registry],
  });

  let lastEventCount = 0;

  const metrics: ControllerMetrics = {
    recordModelSwitch: (recipeId, backend, durationSeconds, success) => {
      if (success) {
        modelSwitchesTotal.labels({ recipe_id: recipeId, backend }).inc();
        modelSwitchDuration.labels({ recipe_id: recipeId }).observe(durationSeconds);
      } else {
        modelLaunchFailures.labels({ recipe_id: recipeId }).inc();
      }
    },
    updateActiveModel: (modelPath, backend, servedName) => {
      activeModelInfo.reset();
      const labels = {
        model_path: modelPath ?? "",
        backend: backend ?? "",
        served_model_name: servedName ?? "",
      };
      activeModelInfo.labels(labels).set(1);
      inferenceServerUp.set(modelPath ? 1 : 0);
    },
    updateGpuMetrics: (gpus) => {
      for (const gpu of gpus) {
        const gpuId = String(gpu["id"] ?? gpu["index"] ?? 0);
        const gpuName = String(gpu["name"] ?? "Unknown");
        const labels = { gpu_id: gpuId, gpu_name: gpuName };
        let memoryUsed = Number(gpu["memory_used"] ?? 0);
        let memoryTotal = Number(gpu["memory_total"] ?? 0);
        if (memoryUsed < 1_000_000) {
          memoryUsed = memoryUsed * 1024 * 1024;
          memoryTotal = memoryTotal * 1024 * 1024;
        }
        gpuMemoryUsed.labels(labels).set(memoryUsed);
        gpuMemoryTotal.labels(labels).set(memoryTotal);
        const utilization = Number(gpu["utilization"] ?? gpu["utilization_pct"] ?? 0);
        const temperature = Number(gpu["temperature"] ?? gpu["temp_c"] ?? 0);
        gpuUtilization.labels(labels).set(utilization);
        gpuTemperature.labels(labels).set(temperature);
      }
    },
    updateSseMetrics: (stats) => {
      const channels = stats["channels"];
      if (channels && typeof channels === "object") {
        for (const [channel, count] of Object.entries(channels)) {
          sseActiveConnections.labels({ channel }).set(Number(count));
        }
      }
      const totalEvents = Number(stats["total_events_published"] ?? 0);
      if (totalEvents > lastEventCount) {
        sseEventsPublished.labels({ event_type: "all" }).inc(totalEvents - lastEventCount);
        lastEventCount = totalEvents;
      } else if (totalEvents < lastEventCount) {
        lastEventCount = totalEvents;
      }
    },
  };

  const metricsRegistry: MetricsRegistry = {
    registry,
    contentType: registry.contentType,
    getMetrics: async () => registry.metrics(),
  };

  return { registry: metricsRegistry, metrics };
};
