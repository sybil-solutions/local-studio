import { AsyncLock, AsyncQueue } from "../../core/async";
import { CONTROLLER_EVENTS } from "@local-studio/contracts/controller-events";

/** Controller event that can be serialized to an SSE frame. */
export class Event {
  public readonly type: string;
  public readonly data: Record<string, unknown>;
  public readonly timestamp: string;
  public readonly id: string;

  public constructor(type: string, data: Record<string, unknown>) {
    this.type = type;
    this.data = data;
    this.timestamp = new Date().toISOString();
    this.id = `${Date.now()}`;
  }

  public toSse(): string {
    const payload = { data: this.data, timestamp: this.timestamp };
    return `id: ${this.id}\nevent: ${this.type}\ndata: ${JSON.stringify(payload)}\n\n`;
  }
}

/** SSE event manager with channels and backpressure handling. */
export class EventManager {
  private readonly subscribers = new Map<string, Set<AsyncQueue<Event>>>();
  private readonly lock = new AsyncLock();
  private latestMetrics: Record<string, unknown> = {};

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

  public async publish(event: Event, channel = "default"): Promise<void> {
    const release = await this.lock.acquire();
    try {
      const subscribers = this.subscribers.get(channel);
      if (!subscribers || subscribers.size === 0) {
        return;
      }

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

  public async publishStatus(statusData: Record<string, unknown>): Promise<void> {
    await this.publish(new Event(CONTROLLER_EVENTS.STATUS, statusData));
  }

  public async publishGpu(gpuData: Record<string, unknown>[]): Promise<void> {
    await this.publish(new Event(CONTROLLER_EVENTS.GPU, { gpus: gpuData, count: gpuData.length }));
  }

  public async publishMetrics(metricsData: Record<string, unknown>): Promise<void> {
    this.latestMetrics = { ...metricsData };
    await this.publish(new Event(CONTROLLER_EVENTS.METRICS, metricsData));
  }

  public getLatestMetrics(): Record<string, unknown> {
    return { ...this.latestMetrics };
  }

  public async publishRuntimeSummary(summaryData: Record<string, unknown>): Promise<void> {
    await this.publish(new Event(CONTROLLER_EVENTS.RUNTIME_SUMMARY, summaryData));
  }

  public async publishLogLine(sessionId: string, line: string): Promise<void> {
    await this.publish(
      new Event(CONTROLLER_EVENTS.LOG, { session_id: sessionId, line }),
      `logs:${sessionId}`,
    );
  }

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
    await this.publish(new Event(CONTROLLER_EVENTS.LAUNCH_PROGRESS, payload));
  }
}
