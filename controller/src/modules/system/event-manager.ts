import { Effect, PubSub, Semaphore, Stream } from "effect";
import { CONTROLLER_EVENTS } from "@local-studio/contracts/controller-events";

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

const abortEffect = (signal?: AbortSignal): Effect.Effect<void> =>
  signal
    ? Effect.callback<void>((resume) => {
        if (signal.aborted) {
          resume(Effect.void);
          return;
        }
        const abort = (): void => resume(Effect.void);
        signal.addEventListener("abort", abort, { once: true });
        return Effect.sync(() => signal.removeEventListener("abort", abort));
      })
    : Effect.never;

export class EventManager {
  private readonly channels = new Map<
    string,
    { readonly pubsub: PubSub.PubSub<Event>; subscribers: number }
  >();
  private readonly channelsLock = Semaphore.makeUnsafe(1);
  private latestMetrics: Record<string, unknown> = {};

  private acquireChannel(
    channel: string,
  ): Effect.Effect<{ readonly pubsub: PubSub.PubSub<Event>; subscribers: number }> {
    const channels = this.channels;
    return this.channelsLock.withPermit(
      Effect.gen(function* () {
        const existing = channels.get(channel);
        if (existing) {
          existing.subscribers += 1;
          return existing;
        }
        const pubsub = yield* PubSub.sliding<Event>(100);
        const created = { pubsub, subscribers: 1 };
        channels.set(channel, created);
        return created;
      }),
    );
  }

  private releaseChannel(
    channel: string,
    entry: { readonly pubsub: PubSub.PubSub<Event>; subscribers: number },
  ): Effect.Effect<void> {
    const channels = this.channels;
    return this.channelsLock.withPermit(
      Effect.gen(function* () {
        const current = channels.get(channel);
        if (current !== entry) return;
        current.subscribers -= 1;
        if (current.subscribers > 0) return;
        channels.delete(channel);
        yield* PubSub.shutdown(current.pubsub);
      }),
    );
  }

  public subscribe(channel = "default", signal?: AbortSignal): Stream.Stream<Event> {
    const stream = Stream.unwrap(
      Effect.acquireRelease(this.acquireChannel(channel), (entry) =>
        this.releaseChannel(channel, entry),
      ).pipe(Effect.map((entry) => Stream.fromPubSub(entry.pubsub))),
    );
    return Stream.scoped(stream).pipe(Stream.interruptWhen(abortEffect(signal)));
  }

  public publish(event: Event, channel = "default"): Effect.Effect<void> {
    const channels = this.channels;
    return this.channelsLock.withPermit(
      Effect.gen(function* () {
        const current = channels.get(channel);
        if (!current) return;
        yield* PubSub.publish(current.pubsub, event);
      }),
    );
  }

  public publishStatus(statusData: Record<string, unknown>): Effect.Effect<void> {
    return this.publish(new Event(CONTROLLER_EVENTS.STATUS, statusData));
  }

  public publishGpu(gpuData: Record<string, unknown>[]): Effect.Effect<void> {
    return this.publish(new Event(CONTROLLER_EVENTS.GPU, { gpus: gpuData, count: gpuData.length }));
  }

  public publishMetrics(metricsData: Record<string, unknown>): Effect.Effect<void> {
    return Effect.sync(() => {
      this.latestMetrics = { ...metricsData };
    }).pipe(Effect.andThen(this.publish(new Event(CONTROLLER_EVENTS.METRICS, metricsData))));
  }

  public getLatestMetrics(): Record<string, unknown> {
    return { ...this.latestMetrics };
  }

  public publishRuntimeSummary(summaryData: Record<string, unknown>): Effect.Effect<void> {
    return this.publish(new Event(CONTROLLER_EVENTS.RUNTIME_SUMMARY, summaryData));
  }

  public publishLogLine(sessionId: string, line: string): Effect.Effect<void> {
    return this.publish(
      new Event(CONTROLLER_EVENTS.LOG, { session_id: sessionId, line }),
      `logs:${sessionId}`,
    );
  }

  public publishLogLineUnsafe(sessionId: string, line: string): void {
    const current = this.channels.get(`logs:${sessionId}`);
    if (!current) return;
    const event = new Event(CONTROLLER_EVENTS.LOG, { session_id: sessionId, line });
    if (PubSub.publishUnsafe(current.pubsub, event)) return;
    if (current.pubsub.shutdownFlag.current) return;
    current.pubsub.pubsub.slide();
    PubSub.publishUnsafe(current.pubsub, event);
  }

  public publishLaunchProgress(
    recipeId: string,
    stage: string,
    message: string,
    progress?: number,
  ): Effect.Effect<void> {
    const payload: Record<string, unknown> = { recipe_id: recipeId, stage, message };
    if (progress !== undefined) payload["progress"] = progress;
    return this.publish(new Event(CONTROLLER_EVENTS.LAUNCH_PROGRESS, payload));
  }

  public shutdown(): Effect.Effect<void> {
    const channels = this.channels;
    return this.channelsLock.withPermit(
      Effect.gen(function* () {
        const entries = [...channels.values()];
        channels.clear();
        yield* Effect.forEach(entries, (entry) => PubSub.shutdown(entry.pubsub), {
          discard: true,
        });
      }),
    );
  }
}
