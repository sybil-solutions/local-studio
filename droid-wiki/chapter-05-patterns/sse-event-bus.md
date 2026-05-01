# Pattern 4 — SSE event bus with channels

The controller is push-driven: it publishes typed events on named channels,
and any number of HTTP clients can subscribe via Server-Sent Events. The
PR keeps this pattern from the previous architecture but tightens the
contract between controller and frontend (the event-name allowlist now
lives in `frontend/src/lib/controller-events-contract.ts` because the
shared workspace package is gone — see Chapter 4).

## Where it appears

| File | Role |
|------|------|
| `controller/src/modules/system/event-manager.ts` | The bus itself: `subscribe(channel)`, `publish(event, channel)`, plus typed helpers (`publishStatus`, `publishGpu`, `publishMetrics`, `publishLaunchProgress`, `publishLogLine`, `publishJobUpdated`). |
| `controller/src/modules/shared/controller-events.ts` | Canonical list of event types (`STATUS`, `GPU`, `METRICS`, `LAUNCH_PROGRESS`, `DOWNLOAD_PROGRESS`, …). Imported by the controller and re-exported via `controller/src/contracts/`. |
| `controller/src/modules/system/routes.ts` | Mounts `/events` (the SSE endpoint). |
| `frontend/src/lib/controller-events-contract.ts` | A 130-line frontend-side mirror that maps each event type to a domain (`controller | recipe | runtime | mcp`) and to a browser `CustomEvent` channel name. |
| `frontend/src/hooks/use-controller-events.ts` | `EventSource` subscription + JSON parse + dispatch via `dispatchControllerDomainEvent`. |
| `frontend/src/hooks/use-controller-events/routing.ts` | Looks up the channel for an incoming event type, dispatches a `CustomEvent` on `window`. |
| `frontend/src/hooks/use-controller-events/routing.test.ts` | Asserts that known types are routed and unknown ones logged. |
| `frontend/src/hooks/use-realtime-status.ts` | One representative consumer; listens to the per-domain `CustomEvent` and merges into local state. |

## The wire format

Each `Event` instance produces an SSE frame:

```ts
public toSse(): string {
  const payload = { data: this.data, timestamp: this.timestamp };
  return `id: ${this.id}\nevent: ${this.type}\ndata: ${JSON.stringify(payload)}\n\n`;
}
```

i.e. each frame names its event type with `event:` (so the browser fires a
matching `EventListener`), and the payload is `{ data, timestamp }`.

Channels are *server-side only*. The HTTP `/events` endpoint subscribes on
behalf of the client to one or more channels (e.g., `default`,
`logs:<sessionId>`). The browser client just sees a single SSE stream.

## Backpressure

`EventManager` uses `AsyncQueue<Event>(100)` per subscriber. Push returns
`false` when full; the publisher then drops that subscriber:

```ts
const ok = queue.push(event);
if (!ok) deadQueues.push(queue);
...
for (const dead of deadQueues) subscribers.delete(dead);
```

i.e. the policy is "kick the slow subscriber, don't slow the publisher".

## Frontend routing

The frontend maps every event type to a `CustomEvent` on `window`:

```ts
const CONTROLLER_BROWSER_EVENT_CHANNEL = {
  recipe:     "vllm:recipe-event",
  runtime:    "vllm:runtime-event",
  controller: "vllm:controller-event",
  mcp:        "vllm:controller-event",
} as const;
```

Each domain channel collects multiple SSE event types. Components
subscribe by listening to the right `CustomEvent` name and filtering by
`event.detail.type`. Unknown event types are logged via
`logUnknownControllerEvent` — a soft contract check that prevents silent
drift.

## Why this pattern

- **One transport, many feeds.** The browser opens *one* `EventSource`,
  not one per concern. Adding a new event type is a contract-update +
  domain-mapping; no new HTTP endpoint, no websocket negotiation.
- **Native browser support.** `EventSource` reconnects automatically.
- **Decouples publishers from subscribers.** The metrics collector
  doesn't know who's listening. Tests publish into the bus and assert
  what comes out the other end — see
  `controller/src/modules/system/event-manager.test.ts`.
- **The event-type allowlist is documentation.** The
  `CONTROLLER_EVENTS` const in `controller-events-contract.ts` is the
  single source of truth that the renderer references when wiring a new
  consumer.

## Trade-offs

- **Lossy under backpressure.** The "drop the slow subscriber" policy
  means a momentarily-stuck client can lose every queued event after the
  100-deep buffer fills. There's no replay.
- **No event sequencing across types.** Each event has a `Date.now()`-
  derived `id`, but two events emitted in the same millisecond race for
  ordering at the consumer.
- **Type drift between server and browser.** Two parallel definitions of
  `CONTROLLER_EVENTS` exist (one in `modules/shared`, one in
  `lib/controller-events-contract.ts`). They are kept in sync by
  convention; nothing prevents divergence.
- **No event-name namespacing.** Anyone can publish an `Event("foo", {})`
  on the default channel and it will hit every subscriber's
  `unknownControllerEvent` log. The convention "use a `CONTROLLER_EVENTS`
  constant" is enforced socially.

## Cross-references

- [Chapter 1 — `stores-and-state.md`](../chapter-01-frontend/stores-and-state.md) — how `useRealtimeStatus` and friends consume the routed events.
- [Chapter 2 — `system-module.md`](../chapter-02-controller/system-module.md) — the system module deep-read.
- [Chapter 4 — `shared-package-dissolution.md`](../chapter-04-anything-else/shared-package-dissolution.md) — why the contract has to be duplicated.
- [Pattern 5 — Browser bridge](./browser-bridge.md) — uses a similar SSE-out pattern but for an in-memory bridge.
