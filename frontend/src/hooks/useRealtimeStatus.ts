import { useState, useCallback, useEffect, useRef } from 'react';
import { useSSE } from './useSSE';
import type { GPU, Metrics, ProcessInfo } from '@/lib/types';

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
  stage: 'preempting' | 'evicting' | 'launching' | 'waiting' | 'ready' | 'cancelled' | 'error';
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
export function useRealtimeStatus(apiBaseUrl: string = '/api/proxy') {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [gpus, setGpus] = useState<GPU[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [launchProgress, setLaunchProgress] = useState<LaunchProgressData | null>(null);
  const lastSSEUpdate = useRef<number>(0);

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      // Parse the SSE data payload
      const payload: SSEEvent = JSON.parse(event.data);
      const eventType = (event as { type?: string }).type || 'message';

      switch (eventType) {
        case 'status':
          setStatus(payload.data as StatusData);
          lastSSEUpdate.current = Date.now();
          break;

        case 'gpu':
          const gpuData = payload.data as GPUData;
          setGpus(gpuData.gpus || []);
          lastSSEUpdate.current = Date.now();
          break;

        case 'metrics':
          setMetrics(payload.data as Metrics);
          lastSSEUpdate.current = Date.now();
          break;

        case 'launch_progress':
          const progressData = payload.data as LaunchProgressData;
          setLaunchProgress(progressData);
          lastSSEUpdate.current = Date.now();

          // Auto-clear progress after success/error
          if (progressData.stage === 'ready' || progressData.stage === 'error' || progressData.stage === 'cancelled') {
            setTimeout(() => setLaunchProgress(null), 5000);
          }
          break;

        default:
          // Don't update lastSSEUpdate for unknown events - keep polling active
          console.log('[SSE] Unknown event type:', eventType);
      }
    } catch (e) {
      console.error('[SSE] Failed to parse event:', e, event.data);
    }
  }, []);

  const { isConnected, error, reconnectAttempts } = useSSE(
    `${apiBaseUrl}/events`,
    true,  // Always enabled
    {
      onMessage: handleMessage,
      reconnectDelay: 2000,  // 2 second initial delay
      maxReconnectAttempts: 10,
    }
  );

  // Fetch status immediately (used on mount and visibility change)
  const fetchStatusNow = useCallback(async () => {
    try {
      const [statusRes] = await Promise.all([
        fetch(`${apiBaseUrl}/status`).then(r => r.json()),
        fetch(`${apiBaseUrl}/health`).then(r => r.json()),
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
        const gpuRes = await fetch(`${apiBaseUrl}/gpus`).then(r => r.json());
        if (gpuRes?.gpus) {
          setGpus(gpuRes.gpus);
        }
      } catch {
        // GPU endpoint might not exist, ignore
      }
    } catch (e) {
      console.error('[Status] Failed to fetch status:', e);
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
      if (document.visibilityState === 'visible') {
        console.log('[Status] Page became visible, fetching fresh status...');
        // Reset last SSE update to force a poll
        lastSSEUpdate.current = 0;
        fetchStatusNow();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Also handle pageshow for bfcache
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        console.log('[Status] Page restored from bfcache, fetching status...');
        lastSSEUpdate.current = 0;
        fetchStatusNow();
      }
    };

    window.addEventListener('pageshow', handlePageShow);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
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
