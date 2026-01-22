import { AsyncLock, AsyncQueue } from "../core/async";

/**
 * SSE event payload structure.
 */
export interface EventPayload {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
  id: string;
}

/**
 * SSE event with serialization helpers.
 */
export class Event {
  public readonly type: string;
  public readonly data: Record<string, unknown>;
  public readonly timestamp: string;
  public readonly id: string;

  /**
   * Create an event.
   * @param type - Event type.
   * @param data - Event payload.
   */
  public constructor(type: string, data: Record<string, unknown>) {
    this.type = type;
    this.data = data;
    this.timestamp = new Date().toISOString();
    this.id = `${Date.now()}`;
  }

  /**
   * Convert event to SSE wire format.
   * @returns SSE string.
   */
  public toSse(): string {
    const payload = { data: this.data, timestamp: this.timestamp };
    return `id: ${this.id}\nevent: ${this.type}\ndata: ${JSON.stringify(payload)}\n\n`;
  }
}

/**
 * SSE event manager with channels and backpressure handling.
 */
export class EventManager {
  private readonly subscribers = new Map<string, Set<AsyncQueue<Event>>>();
  private readonly lock = new AsyncLock();
  private eventCount = 0;

  /**
   * Subscribe to a channel as an async iterator.
   * @param channel - Channel name.
   * @returns Async iterable of events.
   */
  public async *subscribe(channel = "default"): AsyncIterable<Event> {
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
        const event = await queue.shift();
        if (!event) {
          break;
        }
        yield event;
      }
    } catch {
      queue.close();
    } finally {
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
   * Publish an event to a channel.
   * @param event - Event to broadcast.
   * @param channel - Channel name.
   * @returns Promise that resolves after publishing.
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
   * Publish status updates.
   * @param statusData - Status payload.
   * @returns Promise that resolves after publish.
   */
  public async publishStatus(statusData: Record<string, unknown>): Promise<void> {
    await this.publish(new Event("status", statusData));
  }

  /**
   * Publish GPU updates.
   * @param gpuData - GPU info list.
   * @returns Promise that resolves after publish.
   */
  public async publishGpu(gpuData: Record<string, unknown>[]): Promise<void> {
    await this.publish(new Event("gpu", { gpus: gpuData, count: gpuData.length }));
  }

  /**
   * Publish vLLM metrics updates.
   * @param metricsData - Metrics payload.
   * @returns Promise that resolves after publish.
   */
  public async publishMetrics(metricsData: Record<string, unknown>): Promise<void> {
    await this.publish(new Event("metrics", metricsData));
  }

  /**
   * Publish log line updates to a session channel.
   * @param sessionId - Log session identifier.
   * @param line - Log line contents.
   * @returns Promise that resolves after publish.
   */
  public async publishLogLine(sessionId: string, line: string): Promise<void> {
    await this.publish(new Event("log", { session_id: sessionId, line }), `logs:${sessionId}`);
  }

  /**
   * Publish model launch progress.
   * @param recipeId - Recipe identifier.
   * @param stage - Lifecycle stage.
   * @param message - Status message.
   * @param progress - Progress ratio.
   * @returns Promise that resolves after publish.
   */
  public async publishLaunchProgress(
    recipeId: string,
    stage: string,
    message: string,
    progress?: number,
  ): Promise<void> {
    const payload: Record<string, unknown> = { recipe_id: recipeId, stage, message };
    if (progress !== undefined) {
      payload["progress"] = progress;
    }
    await this.publish(new Event("launch_progress", payload));
  }

  /**
   * Return event manager statistics.
   * @returns Stats payload.
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
 * Create a new EventManager instance.
 * @returns EventManager.
 */
export const createEventManager = (): EventManager => new EventManager();
