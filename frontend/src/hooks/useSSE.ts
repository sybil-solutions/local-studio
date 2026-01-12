import { useEffect, useRef, useState, useCallback } from 'react';

interface SSEOptions {
  /**
   * Callback when a message is received.
   * Use event.type to differentiate event types.
   */
  onMessage?: (event: MessageEvent) => void;

  /**
   * Callback when connection fails.
   */
  onError?: (error: Event) => void;

  /**
   * Delay before reconnecting (ms).
   * Default: 3000 (3 seconds)
   */
  reconnectDelay?: number;

  /**
   * Max number of reconnection attempts.
   * Default: Infinity
   */
  maxReconnectAttempts?: number;
}

/**
 * Hook for managing Server-Sent Events connections.
 *
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Connection state tracking
 * - Cleanup on unmount
 *
 * @example
 * const { isConnected, error } = useSSE('/api/proxy/events', true, {
 *   onMessage: (e) => console.log('Event:', e.type, e.data)
 * });
 */
export function useSSE(
  url: string,
  enabled: boolean = true,
  options: SSEOptions = {}
) {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const {
    onMessage,
    onError,
    reconnectDelay = 3000,
    maxReconnectAttempts = Infinity,
  } = options;

  const connect = useCallback(() => {
    if (!enabled || !url || eventSourceRef.current) return;

    try {
      console.log(`[SSE] Connecting to ${url}`);
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        setIsConnected(true);
        setError(null);
        setReconnectAttempts(0);
        console.log(`[SSE] Connected to ${url}`);
      };

      // Handle generic messages (no event type)
      es.onmessage = (event) => {
        onMessage?.(event);
      };

      // Handle errors and reconnection
      es.onerror = (err) => {
        console.error(`[SSE] Connection error on ${url}`, err);
        setIsConnected(false);
        setError('Connection lost');
        onError?.(err);

        // Close connection
        es.close();
        eventSourceRef.current = null;

        // Schedule reconnect if enabled and under limit
        if (enabled && reconnectAttempts < maxReconnectAttempts) {
          const delay = Math.min(reconnectDelay * Math.pow(2, reconnectAttempts), 30000);
          console.log(`[SSE] Reconnecting in ${delay}ms (attempt ${reconnectAttempts + 1})`);

          reconnectTimeoutRef.current = setTimeout(() => {
            setReconnectAttempts(prev => prev + 1);
            connect();
          }, delay);
        } else if (reconnectAttempts >= maxReconnectAttempts) {
          setError('Max reconnection attempts reached');
        }
      };

      // Add event listeners for specific event types
      // EventSource automatically parses "event: <type>" lines
      ['status', 'gpu', 'metrics', 'launch_progress', 'log'].forEach(eventType => {
        es.addEventListener(eventType, (event) => {
          onMessage?.(event as MessageEvent);
        });
      });

    } catch (err) {
      console.error(`[SSE] Failed to create EventSource:`, err);
      setError(err instanceof Error ? err.message : 'Connection failed');
    }
  }, [url, enabled, onMessage, onError, reconnectDelay, maxReconnectAttempts, reconnectAttempts]);

  // Connect/disconnect based on enabled flag
  useEffect(() => {
    if (enabled && url) {
      connect();
    }

    return () => {
      // Cleanup on unmount or when disabled
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (eventSourceRef.current) {
        console.log(`[SSE] Closing connection to ${url}`);
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [connect, enabled, url]);

  // Reconnect when page becomes visible again (mobile PWA support)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && enabled && url) {
        console.log('[SSE] Page became visible, checking connection...');

        // Check if connection is dead
        if (!eventSourceRef.current || eventSourceRef.current.readyState === EventSource.CLOSED) {
          console.log('[SSE] Connection dead, reconnecting...');
          setReconnectAttempts(0); // Reset attempts on visibility change

          // Clear any pending reconnect
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
          }

          // Force reconnect
          eventSourceRef.current = null;
          connect();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Also handle pageshow for bfcache (back-forward cache)
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted && enabled && url) {
        console.log('[SSE] Page restored from bfcache, reconnecting...');
        setReconnectAttempts(0);
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
        }
        eventSourceRef.current = null;
        connect();
      }
    };

    window.addEventListener('pageshow', handlePageShow);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [connect, enabled, url]);

  return {
    isConnected,
    error,
    reconnectAttempts,
  };
}
