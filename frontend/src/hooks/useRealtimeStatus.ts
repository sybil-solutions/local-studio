import { useState, useCallback } from 'react';
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
 * Hook for real-time status updates via SSE.
 *
 * Subscribes to:
 * - status: Process running state
 * - gpu: GPU metrics
 * - metrics: vLLM performance metrics
 * - launch_progress: Model launch progress
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

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      // Parse the SSE data payload
      const payload: SSEEvent = JSON.parse(event.data);
      const eventType = (event as { type?: string }).type || 'message';

      switch (eventType) {
        case 'status':
          setStatus(payload.data as StatusData);
          break;

        case 'gpu':
          const gpuData = payload.data as GPUData;
          setGpus(gpuData.gpus || []);
          break;

        case 'metrics':
          setMetrics(payload.data as Metrics);
          break;

        case 'launch_progress':
          const progressData = payload.data as LaunchProgressData;
          setLaunchProgress(progressData);

          // Auto-clear progress after success/error
          if (progressData.stage === 'ready' || progressData.stage === 'error' || progressData.stage === 'cancelled') {
            setTimeout(() => setLaunchProgress(null), 5000);
          }
          break;

        default:
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
