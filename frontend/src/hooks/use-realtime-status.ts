// CRITICAL
import { useState, useCallback, useEffect, useRef } from "react";
import type { GPU, Metrics, ProcessInfo } from "@/lib/types";
import { getApiKey } from "@/lib/api-key";

interface StatusData {
  running: boolean;
  process: ProcessInfo | null;
  inference_port: number;
}

interface GPUData {
  gpus: GPU[];
  count: number;
}

interface LaunchProgressData {
  recipe_id: string;
  stage: "preempting" | "evicting" | "launching" | "waiting" | "ready" | "cancelled" | "error";
  message: string;
  progress?: number;
}

interface SSEEvent {
  data: unknown;
  timestamp: string;
}

/**
 * Hook for real-time status updates via SSE with polling fallback.
 *
 * Subscribes to:
 * - status: Process running state
 * - gpu: GPU metrics
 * - metrics: vLLM performance metrics
 * - launch_progress: Model launch progress
 *
 * Falls back to polling /status every 5 seconds when SSE fails.
 *
 * @param apiBaseUrl - Base URL for the API (default: empty for relative URLs)
 *
 * @example
 * const { status, gpus, metrics, launchProgress } = useRealtimeStatus();
 */
export function useRealtimeStatus(
  apiBaseUrl: string =
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    process.env.VLLM_STUDIO_BACKEND_URL ||
    process.env.BACKEND_URL ||
    "/api/proxy",
) {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [gpus, setGpus] = useState<GPU[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [launchProgress, setLaunchProgress] = useState<LaunchProgressData | null>(null);
  const lastSSEUpdate = useRef<number>(0);

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      // Parse the SSE data payload
      const payload: SSEEvent = JSON.parse(event.data);
      const eventType = (event as { type?: string }).type || "message";

      switch (eventType) {
        case "status":
          setStatus(payload.data as StatusData);
          lastSSEUpdate.current = Date.now();
          break;

        case "gpu":
          const gpuData = payload.data as GPUData;
          setGpus(gpuData.gpus || []);
          lastSSEUpdate.current = Date.now();
          break;

        case "metrics":
          setMetrics(payload.data as Metrics);
          lastSSEUpdate.current = Date.now();
          break;

        case "launch_progress":
          const progressData = payload.data as LaunchProgressData;
          setLaunchProgress(progressData);
          lastSSEUpdate.current = Date.now();

          // Auto-clear progress after success/error
          if (
            progressData.stage === "ready" ||
            progressData.stage === "error" ||
            progressData.stage === "cancelled"
          ) {
            setTimeout(() => setLaunchProgress(null), 5000);
          }
          break;

        default:
          // Don't update lastSSEUpdate for unknown events - keep polling active
          console.log("[SSE] Unknown event type:", eventType);
      }
    } catch (e) {
      console.error("[SSE] Failed to parse event:", e, event.data);
    }
  }, []);

  // Build SSE URL with API key as query param (EventSource doesn't support headers)
  const apiKey = getApiKey();
  const sseUrl = apiKey
    ? `${apiBaseUrl}/events?api_key=${encodeURIComponent(apiKey)}`
    : `${apiBaseUrl}/events`;

  // Inline SSE connection with auto-reconnect
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectSSERef = useRef<() => void>(() => {});

  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;

      es.onopen = () => {
        setIsConnected(true);
        setError(null);
        setReconnectAttempts(0);
      };

      // Handle named events (event: type in SSE)
      es.addEventListener("status", (event) => handleMessage(event as MessageEvent));
      es.addEventListener("gpu", (event) => handleMessage(event as MessageEvent));
      es.addEventListener("metrics", (event) => handleMessage(event as MessageEvent));
      es.addEventListener("launch_progress", (event) => handleMessage(event as MessageEvent));
      es.addEventListener("log", (event) => handleMessage(event as MessageEvent));

      // Fallback for unnamed events
      es.onmessage = (event) => {
        handleMessage(event as MessageEvent);
      };

      es.onerror = () => {
        setIsConnected(false);
        setError("Connection lost");

        // Schedule reconnect
        const delay = Math.min(2000 * Math.pow(2, reconnectAttempts), 30000);
        if (reconnectAttempts < 10) {
          reconnectTimeoutRef.current = setTimeout(() => {
            setReconnectAttempts((prev) => prev + 1);
            connectSSERef.current();
          }, delay);
        }
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    }
  }, [sseUrl, reconnectAttempts, handleMessage]);

  useEffect(() => {
    connectSSERef.current = connectSSE;
  }, [connectSSE]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      connectSSERef.current();
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [connectSSE]);

  // Fetch status immediately (used on mount and visibility change)
  const fetchStatusNow = useCallback(async () => {
    const headers: Record<string, string> = {};
    const key = getApiKey();
    if (key) {
      headers["Authorization"] = `Bearer ${key}`;
    }

    try {
      const [statusRes] = await Promise.all([
        fetch(`${apiBaseUrl}/status`, { headers }).then((r) => r.json()),
        fetch(`${apiBaseUrl}/health`, { headers }).then((r) => r.json()),
      ]);

      // Update status from polling
      if (statusRes) {
        setStatus({
          running: statusRes.running ?? !!statusRes.process,
          process: statusRes.process ?? null,
          inference_port: statusRes.inference_port || 8000,
        });
      }

      // Try to get GPU data from a separate endpoint if available
      try {
        const gpuRes = await fetch(`${apiBaseUrl}/gpus`, { headers }).then((r) => r.json());
        if (gpuRes?.gpus) {
          setGpus(gpuRes.gpus);
        }
      } catch {
        // GPU endpoint might not exist, ignore
      }
    } catch (e) {
      console.error("[Status] Failed to fetch status:", e);
    }
  }, [apiBaseUrl]);

  // Polling fallback when SSE is not working
  useEffect(() => {
    const pollData = async () => {
      // Skip if SSE updated recently (within last 10 seconds)
      if (Date.now() - lastSSEUpdate.current < 10000) return;
      await fetchStatusNow();
    };

    // Poll immediately on mount and every 5 seconds
    pollData();
    const interval = setInterval(pollData, 5000);
    return () => clearInterval(interval);
  }, [fetchStatusNow]);

  // Force refresh when page becomes visible (mobile PWA support)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        console.log("[Status] Page became visible, fetching fresh status...");
        // Reset last SSE update to force a poll
        lastSSEUpdate.current = 0;
        fetchStatusNow();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Also handle pageshow for bfcache
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        console.log("[Status] Page restored from bfcache, fetching status...");
        lastSSEUpdate.current = 0;
        fetchStatusNow();
      }
    };

    window.addEventListener("pageshow", handlePageShow);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [fetchStatusNow]);

  return {
    // Data
    status,
    gpus,
    metrics,
    launchProgress,

    // Connection state
    isConnected,
    error,
    reconnectAttempts,
  };
}
