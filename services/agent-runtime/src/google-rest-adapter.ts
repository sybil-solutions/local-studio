import type { McpConnection, McpToolInfo } from "./mcp-client";
import {
  GOOGLE_WORKSPACE_BINDINGS,
  type GoogleWorkspacePluginId,
} from "./google-workspace-binding";

/**
 * The read-only Google tools, served from the public REST APIs.
 *
 * Google's first-party Workspace MCP servers are a developer preview and we
 * cannot confirm they accept a self-registered Desktop OAuth client, so the
 * default transport is this in-process adapter: it implements the same
 * `McpConnection` surface and exposes exactly the tool names the remote server
 * declares, so the connector, the skill, and stored transcripts do not know
 * which transport answered.
 *
 * Every tool here is a GET (or, for free/busy, a query-shaped POST) against a
 * read-only scope. Nothing in this file can mutate a mailbox or a calendar.
 */

type RestRequest = {
  method?: "GET" | "POST";
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
};

type RestToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  build: (args: Record<string, unknown>) => RestRequest;
  project?: (payload: unknown) => unknown;
};

export class GoogleRestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

const stringProperty = (description: string) => ({ type: "string", description });
const numberProperty = (description: string) => ({ type: "number", description });

function text(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function requiredText(args: Record<string, unknown>, key: string): string {
  const value = text(args, key);
  if (!value) throw new GoogleRestError(400, `"${key}" is required`);
  return value;
}

function count(args: Record<string, unknown>, key: string, fallback: number): string {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return String(fallback);
  return String(Math.max(1, Math.min(500, Math.trunc(value))));
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function decodeBase64Url(value: string): string {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

/** Pull the first text/plain (else text/html) part out of a Gmail MIME tree. */
function messageBody(payload: Record<string, unknown> | null, wanted: string): string {
  if (!payload) return "";
  const mimeType = typeof payload.mimeType === "string" ? payload.mimeType : "";
  const body = record(payload.body);
  const data = body && typeof body.data === "string" ? body.data : "";
  if (mimeType === wanted && data) return decodeBase64Url(data);
  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  for (const part of parts) {
    const found = messageBody(record(part), wanted);
    if (found) return found;
  }
  return "";
}

const KEPT_HEADERS = new Set(["from", "to", "cc", "subject", "date", "reply-to"]);

function messageHeaders(payload: Record<string, unknown> | null): Record<string, string> {
  const headers = payload && Array.isArray(payload.headers) ? payload.headers : [];
  const kept: Record<string, string> = {};
  for (const entry of headers) {
    const header = record(entry);
    const name = header && typeof header.name === "string" ? header.name.toLowerCase() : "";
    const value = header && typeof header.value === "string" ? header.value : "";
    if (name && value && KEPT_HEADERS.has(name)) kept[name] = value;
  }
  return kept;
}

/**
 * A Gmail message with `format=full` carries every MIME part base64-encoded,
 * including attachments. Handing that to a model is unusable, so each message
 * becomes its addressing headers plus the decoded text body.
 */
function projectMessage(value: unknown): unknown {
  const message = record(value);
  if (!message) return value;
  const payload = record(message.payload);
  const plain = messageBody(payload, "text/plain") || messageBody(payload, "text/html");
  return {
    id: message.id,
    threadId: message.threadId,
    labelIds: message.labelIds,
    snippet: message.snippet,
    headers: messageHeaders(payload),
    body: plain || message.snippet || "",
  };
}

function projectThread(value: unknown): unknown {
  const thread = record(value);
  if (!thread) return value;
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  return { id: thread.id, messages: messages.map(projectMessage) };
}

const GMAIL_TOOLS: RestToolSpec[] = [
  {
    name: "list_labels",
    description: "List the labels in the connected Gmail account.",
    inputSchema: objectSchema({}),
    build: () => ({ path: "/users/me/labels" }),
  },
  {
    name: "search_threads",
    description:
      "Search mail threads with Gmail query syntax (for example `from:ana has:attachment newer_than:7d`).",
    inputSchema: objectSchema({
      query: stringProperty("Gmail search query."),
      max_results: numberProperty("Maximum threads to return (default 20)."),
      page_token: stringProperty("Continuation token from a previous search."),
    }),
    build: (args) => ({
      path: "/users/me/threads",
      query: {
        q: text(args, "query"),
        maxResults: count(args, "max_results", 20),
        pageToken: text(args, "page_token"),
      },
    }),
  },
  {
    name: "get_thread",
    description: "Read one mail thread, including the decoded text of every message in it.",
    inputSchema: objectSchema({ thread_id: stringProperty("Thread id.") }, ["thread_id"]),
    build: (args) => ({
      path: `/users/me/threads/${encodeURIComponent(requiredText(args, "thread_id"))}`,
      query: { format: "full" },
    }),
    project: projectThread,
  },
  {
    name: "get_message",
    description: "Read one mail message, including its decoded text body.",
    inputSchema: objectSchema({ message_id: stringProperty("Message id.") }, ["message_id"]),
    build: (args) => ({
      path: `/users/me/messages/${encodeURIComponent(requiredText(args, "message_id"))}`,
      query: { format: "full" },
    }),
    project: projectMessage,
  },
  {
    name: "list_drafts",
    description: "List saved drafts in the connected Gmail account.",
    inputSchema: objectSchema({
      max_results: numberProperty("Maximum drafts to return (default 20)."),
    }),
    build: (args) => ({
      path: "/users/me/drafts",
      query: { maxResults: count(args, "max_results", 20) },
    }),
  },
];

const CALENDAR_TOOLS: RestToolSpec[] = [
  {
    name: "list_calendars",
    description: "List the calendars the connected account can read.",
    inputSchema: objectSchema({}),
    build: () => ({ path: "/users/me/calendarList" }),
  },
  {
    name: "list_events",
    description: "List events on a calendar within a time window.",
    inputSchema: objectSchema({
      calendar_id: stringProperty("Calendar id (default `primary`)."),
      time_min: stringProperty("RFC 3339 lower bound."),
      time_max: stringProperty("RFC 3339 upper bound."),
      query: stringProperty("Free-text search over event fields."),
      max_results: numberProperty("Maximum events to return (default 50)."),
    }),
    build: (args) => ({
      path: `/calendars/${encodeURIComponent(text(args, "calendar_id") ?? "primary")}/events`,
      query: {
        timeMin: text(args, "time_min"),
        timeMax: text(args, "time_max"),
        q: text(args, "query"),
        maxResults: count(args, "max_results", 50),
        singleEvents: "true",
        orderBy: "startTime",
      },
    }),
  },
  {
    name: "get_event",
    description: "Read one calendar event.",
    inputSchema: objectSchema(
      {
        calendar_id: stringProperty("Calendar id (default `primary`)."),
        event_id: stringProperty("Event id."),
      },
      ["event_id"],
    ),
    build: (args) => ({
      path: `/calendars/${encodeURIComponent(text(args, "calendar_id") ?? "primary")}/events/${encodeURIComponent(requiredText(args, "event_id"))}`,
    }),
  },
  {
    name: "suggest_time",
    description:
      "Return the busy intervals for the given calendars and window, so free slots can be chosen from what is left.",
    inputSchema: objectSchema(
      {
        time_min: stringProperty("RFC 3339 start of the window."),
        time_max: stringProperty("RFC 3339 end of the window."),
        calendar_ids: {
          type: "array",
          items: { type: "string" },
          description: "Calendars to inspect (default `primary`).",
        },
      },
      ["time_min", "time_max"],
    ),
    build: (args) => {
      const calendars = Array.isArray(args.calendar_ids)
        ? args.calendar_ids.filter((id): id is string => typeof id === "string" && Boolean(id))
        : [];
      return {
        method: "POST",
        path: "/freeBusy",
        body: {
          timeMin: requiredText(args, "time_min"),
          timeMax: requiredText(args, "time_max"),
          items: (calendars.length ? calendars : ["primary"]).map((id) => ({ id })),
        },
      };
    },
  },
];

const TOOLS: Record<GoogleWorkspacePluginId, RestToolSpec[]> = {
  gmail: GMAIL_TOOLS,
  "google-calendar": CALENDAR_TOOLS,
};

function toolInfo(spec: RestToolSpec): McpToolInfo {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema as McpToolInfo["inputSchema"],
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  };
}

function requestUrl(base: string, request: RestRequest): string {
  const url = new URL(`${base}${request.path}`);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

async function errorMessage(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  const error = record(record(body)?.error);
  const message = error && typeof error.message === "string" ? error.message : "";
  return message || `Google returned ${response.status}`;
}

export type GoogleRestConnectionInput = {
  service: GoogleWorkspacePluginId;
  authorize: (forceRefresh: boolean) => Promise<Record<string, string>>;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  requestTimeoutMs?: number;
};

export function createGoogleRestConnection(input: GoogleRestConnectionInput): McpConnection {
  const base = GOOGLE_WORKSPACE_BINDINGS[input.service].restEndpoint;
  const send = input.fetch ?? fetch;
  let closed = false;

  const signal = (): AbortSignal => {
    const timeout = AbortSignal.timeout(input.requestTimeoutMs ?? 30_000);
    return input.signal ? AbortSignal.any([timeout, input.signal]) : timeout;
  };

  const call = async (request: RestRequest, forceRefresh: boolean): Promise<Response> => {
    const headers = new Headers(await input.authorize(forceRefresh));
    if (request.body !== undefined) headers.set("content-type", "application/json");
    return send(requestUrl(base, request), {
      method: request.method ?? "GET",
      headers,
      redirect: "error",
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      signal: signal(),
    });
  };

  return {
    listTools: () => Promise.resolve(TOOLS[input.service].map(toolInfo)),
    async callTool(name, args) {
      if (closed) throw new GoogleRestError(499, "Google connection is closed");
      const spec = TOOLS[input.service].find((candidate) => candidate.name === name);
      if (!spec) throw new GoogleRestError(404, `Unknown tool "${name}"`);
      const request = spec.build(args ?? {});
      let response = await call(request, false);
      // Same contract as the MCP HTTP client: one silent retry with a freshly
      // minted access token before surfacing an authorization failure.
      if (response.status === 401) response = await call(request, true);
      if (!response.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: `${name} failed: ${await errorMessage(response)}` }],
        };
      }
      const payload: unknown = await response.json().catch(() => null);
      const projected = spec.project ? spec.project(payload) : payload;
      return { content: [{ type: "text", text: JSON.stringify(projected, null, 2) }] };
    },
    close() {
      closed = true;
    },
  };
}
