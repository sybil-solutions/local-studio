// CRITICAL
import { describe, expect, it, vi } from "vitest";
import {
  CONTROLLER_BROWSER_EVENT_CHANNEL,
  CONTROLLER_EVENTS,
} from "@/lib/controller-events-contract";
import {
  dispatchControllerDomainEvent,
  isKnownControllerEvent,
  logUnknownControllerEvent,
  resolveControllerEventChannel,
} from "./routing";

describe("controller event routing", () => {
  it("routes known controller events to browser channels", () => {
    expect(resolveControllerEventChannel(CONTROLLER_EVENTS.STATUS)).toBe(
      CONTROLLER_BROWSER_EVENT_CHANNEL.controller,
    );
    expect(resolveControllerEventChannel(CONTROLLER_EVENTS.RECIPE_CREATED)).toBe(
      CONTROLLER_BROWSER_EVENT_CHANNEL.recipe,
    );
  });

  it("dispatches known events and returns true", () => {
    const dispatch = vi.fn();
    const data = { id: "job-1" };

    const handled = dispatchControllerDomainEvent(CONTROLLER_EVENTS.JOB_UPDATED, data, dispatch);

    expect(handled).toBe(true);
    expect(dispatch).toHaveBeenCalledWith(CONTROLLER_BROWSER_EVENT_CHANNEL.controller, {
      type: CONTROLLER_EVENTS.JOB_UPDATED,
      data,
    });
  });

  it("returns false for unknown events", () => {
    const dispatch = vi.fn();
    const handled = dispatchControllerDomainEvent("unknown_event", {}, dispatch);

    expect(handled).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("logs unknown events with explicit payload", () => {
    const logger = vi.fn();
    const data = { foo: "bar" };

    logUnknownControllerEvent("mystery_event", data, logger);

    expect(logger).toHaveBeenCalledWith("[Controller SSE] Unhandled event type", {
      eventType: "mystery_event",
      data,
    });
  });

  it("identifies known vs unknown event names", () => {
    expect(isKnownControllerEvent(CONTROLLER_EVENTS.RUNTIME_SUMMARY)).toBe(true);
    expect(isKnownControllerEvent("definitely_not_known")).toBe(false);
  });
});
