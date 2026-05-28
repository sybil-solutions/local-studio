"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { getApiKey } from "@/lib/api-key";
import { BACKEND_URL_CHANGED_EVENT } from "@/lib/backend-url";
import { resolveControllerEventsBaseUrl } from "@/lib/backend-config";
import { CONTROLLER_EVENT_TYPES } from "./use-controller-events/event-types";
import { dispatchCustomEvent } from "./use-controller-events/helpers";
import {
  dispatchControllerDomainEvent,
  isKnownControllerEvent,
  logUnknownControllerEvent,
} from "./use-controller-events/routing";

interface SSEPayload<T = unknown> {
  data: T;
  timestamp: string;
}

export function useControllerEvents(apiBaseUrl: string = resolveControllerEventsBaseUrl()) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const [backendRevision, setBackendRevision] = useState(0);

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const payload = JSON.parse(event.data) as SSEPayload<Record<string, unknown>>;
      const eventType = (event as { type?: string }).type || "message";
      const data = payload.data ?? {};

      const handled = dispatchControllerDomainEvent(eventType, data, dispatchCustomEvent);
      if (!handled && !isKnownControllerEvent(eventType)) {
        logUnknownControllerEvent(eventType, data);
      }
    } catch (err) {
      console.error("[Controller SSE] Failed to parse event:", err);
    }
  }, []);

  const apiKey = getApiKey();
  const sseUrl = apiKey
    ? `${apiBaseUrl}/events?api_key=${encodeURIComponent(apiKey)}`
    : `${apiBaseUrl}/events`;

  const subscribeControllerEvents = useCallback(
    (_notify: () => void) => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;

      for (const type of CONTROLLER_EVENT_TYPES) {
        es.addEventListener(type, (event) => handleMessage(event as MessageEvent));
      }

      es.onmessage = (event) => handleMessage(event as MessageEvent);

      return () => {
        es.close();
      };
    },
    [backendRevision, handleMessage, sseUrl],
  );

  const subscribeBackendChanges = useCallback((_notify: () => void) => {
    const reconnect = () => setBackendRevision((value) => value + 1);
    window.addEventListener(BACKEND_URL_CHANGED_EVENT, reconnect);
    return () => window.removeEventListener(BACKEND_URL_CHANGED_EVENT, reconnect);
  }, []);

  useSyncExternalStore(
    subscribeControllerEvents,
    getControllerEventsSnapshot,
    getControllerEventsSnapshot,
  );
  useSyncExternalStore(
    subscribeBackendChanges,
    getControllerEventsSnapshot,
    getControllerEventsSnapshot,
  );
}

const getControllerEventsSnapshot = (): number => 0;
