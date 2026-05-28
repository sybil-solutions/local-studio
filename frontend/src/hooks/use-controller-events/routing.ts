import {
  getBrowserEventChannelForControllerEvent,
  isControllerStreamEventType,
  type ControllerBrowserEventChannel,
} from "@/lib/controller-events-contract";

export type UnknownControllerEventLogger = (
  message: string,
  detail: { eventType: string; data: Record<string, unknown> },
) => void;

export const resolveControllerEventChannel = (
  eventType: string,
): ControllerBrowserEventChannel | null => {
  return getBrowserEventChannelForControllerEvent(eventType);
};

export const dispatchControllerDomainEvent = (
  eventType: string,
  data: Record<string, unknown>,
  dispatch: (name: string, detail: Record<string, unknown>) => void,
): boolean => {
  const channel = resolveControllerEventChannel(eventType);
  if (!channel) {
    return false;
  }
  dispatch(channel, { type: eventType, data });
  return true;
};

export const logUnknownControllerEvent = (
  eventType: string,
  data: Record<string, unknown>,
  logger: UnknownControllerEventLogger = (message, detail) => {
    console.warn(message, detail);
  },
): void => {
  logger("[Controller SSE] Unhandled event type", { eventType, data });
};

export const isKnownControllerEvent = (eventType: string): boolean => {
  return isControllerStreamEventType(eventType);
};
