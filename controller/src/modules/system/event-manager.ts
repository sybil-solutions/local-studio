// CRITICAL
import { AsyncLock, AsyncQueue } from "../../core/async";
import { CONTROLLER_EVENTS } from "../../contracts/controller-events";

/** Serialized controller event payload. */
export interface EventPayload {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
  id: string;
}

/** Controller event that can be serialized to an SSE frame. */
export class Event {
  public readonly type: string;
  public readonly data: Record<string, unknown>;
  public readonly timestamp: string;
  public readonly id: string;

  /**
   * Create a controller event.
   * @param type - Controller event type.
   * @param data - Event payload data.
   */
  public constructor(type: string, data: Record<string, unknown>) {
    this.type = type;
    this.data = data;
    this.timestamp = new Date().toISOString();
    this.id = `${Date.now()}`;
  }

  /**
   * Serialize this event as a Server-Sent Events frame.
   * @returns SSE wire payload.
   */
  public toSse(): string {
    const payload = { data: this.data, timestamp: this.timestamp };
    return `id: ${this.id}\nevent: ${this.type}\ndata: ${JSON.stringify(payload)}\n\n`;
  }
}

/** SSE event manager with channels and backpressure handling. */
export class EventManager {
  private readonly subscribers = new Map<string, Set<AsyncQueue<Event>>>();
  private readonly lock = new AsyncLock();
  private eventCount = 0;
  private latestMetrics: Record<string, unknown> = {};

  /**
   * Subscribe to events on a channel.
   * @param channel - Event channel name.
   * @param signal - Optional abort signal.
   * @returns Async event stream.
   */
  public async *subscribe(channel = "default", signal?: AbortSignal): AsyncIterable<Event> {
    const queue = new AsyncQueue<Event>(100);
    const release = await this.lock.acquire();
    try {
      const existing = this.subscribers.get(channel) ?? new Set<AsyncQueue<Event>>();
      existing.add(queue);
      this.subscribers.set(channel, existing);
    } finally {
      release();
    }

    try {
      while (true) {
        if (signal?.aborted) break;
        let event: Event;
        try {
          event = await queue.shift(signal);
        } catch {
          break;
        }
        yield event;
      }
    } finally {
      queue.close();
      const releaseCleanup = await this.lock.acquire();
      try {
        const existing = this.subscribers.get(channel);
        if (existing) {
          existing.delete(queue);
          if (existing.size === 0) {
            this.subscribers.delete(channel);
          }
        }
      } finally {
        releaseCleanup();
      }
    }
  }

  /**
   * Publish an event to subscribers on a channel.
   * @param event - Event to publish.
   * @param channel - Event channel name.
   */
  public async publish(event: Event, channel = "default"): Promise<void> {
    const release = await this.lock.acquire();
    try {
      const subscribers = this.subscribers.get(channel);
      if (!subscribers || subscribers.size === 0) {
        return;
      }

      this.eventCount += 1;
      const deadQueues: AsyncQueue<Event>[] = [];

      for (const queue of subscribers) {
        const ok = queue.push(event);
        if (!ok) {
          deadQueues.push(queue);
        }
      }

      for (const dead of deadQueues) {
        subscribers.delete(dead);
      }
    } finally {
      release();
    }
  }

  /**
   * Publish a status update.
   * @param statusData - Status payload.
   */
  public async publishStatus(statusData: Record<string, unknown>): Promise<void> {
    await this.publish(new Event(CONTROLLER_EVENTS.STATUS, statusData));
  }

  /**
   * Publish GPU state.
   * @param gpuData - GPU payload list.
   */
  public async publishGpu(gpuData: Record<string, unknown>[]): Promise<void> {
    await this.publish(new Event(CONTROLLER_EVENTS.GPU, { gpus: gpuData, count: gpuData.length }));
  }

  /**
   * Publish runtime metrics.
   * @param metricsData - Metrics payload.
   */
  public async publishMetrics(metricsData: Record<string, unknown>): Promise<void> {
    this.latestMetrics = { ...metricsData };
    await this.publish(new Event(CONTROLLER_EVENTS.METRICS, metricsData));
  }

  /**
   * Return the latest metrics event payload for non-SSE polling clients.
   * @returns Latest metrics payload.
   */
  public getLatestMetrics(): Record<string, unknown> {
    return { ...this.latestMetrics };
  }

  /**
   * Publish runtime summary data.
   * @param summaryData - Runtime summary payload.
   */
  public async publishRuntimeSummary(summaryData: Record<string, unknown>): Promise<void> {
    await this.publish(new Event(CONTROLLER_EVENTS.RUNTIME_SUMMARY, summaryData));
  }

  /**
   * Publish a job update.
   * @param jobData - Job payload.
   */
  public async publishJobUpdated(jobData: Record<string, unknown>): Promise<void> {
    await this.publish(new Event(CONTROLLER_EVENTS.JOB_UPDATED, jobData));
  }

  /**
   * Publish a log line for a session.
   * @param sessionId - Log session id.
   * @param line - Log line.
   */
  public async publishLogLine(sessionId: string, line: string): Promise<void> {
    await this.publish(
      new Event(CONTROLLER_EVENTS.LOG, { session_id: sessionId, line }),
      `logs:${sessionId}`
    );
  }

  /**
   * Publish launch progress.
   * @param recipeId - Recipe id.
   * @param stage - Launch stage.
   * @param message - Human-readable progress message.
   * @param progress - Optional progress percentage.
   */
  public async publishLaunchProgress(
    recipeId: string,
    stage: string,
    message: string,
    progress?: number
  ): Promise<void> {
    const payload: Record<string, unknown> = { recipe_id: recipeId, stage, message };
    if (progress !== undefined) {
      payload["progress"] = progress;
    }
    await this.publish(new Event(CONTROLLER_EVENTS.LAUNCH_PROGRESS, payload));
  }

  /**
   * Return event manager subscriber and publish stats.
   * @returns Event manager stats.
   */
  public getStats(): Record<string, unknown> {
    const channels: Record<string, number> = {};
    let totalSubscribers = 0;
    for (const [channel, set] of this.subscribers.entries()) {
      channels[channel] = set.size;
      totalSubscribers += set.size;
    }
    return {
      total_events_published: this.eventCount,
      channels,
      total_subscribers: totalSubscribers,
    };
  }
}

/**
 * Create an event manager.
 * @returns New event manager instance.
 */
export const createEventManager = (): EventManager => new EventManager();
