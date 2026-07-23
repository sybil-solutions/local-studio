import { Effect, Schema } from "effect";
import {
  AutomationResponseSchema,
  AutomationsResponseSchema,
  type Automation,
} from "@shared/agent/automation";
import type { AutomationDraft } from "./automation-model";

const AgentModelSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

const AgentModelsResponseSchema = Schema.Struct({
  models: Schema.Array(AgentModelSchema),
});

const RunResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
  started: Schema.Boolean,
});

const DeleteResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
});

export type AutomationModel = typeof AgentModelSchema.Type;

async function errorMessage(response: Response): Promise<string> {
  const fallback = `Request failed with HTTP ${response.status}`;
  try {
    const body = (await response.json()) as unknown;
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      return body.error;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function requestJson<A>(
  input: string,
  decode: (input: unknown) => A,
  init?: RequestInit,
): Effect.Effect<A, Error> {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(input, { cache: "no-store", ...init });
      if (!response.ok) throw new Error(await errorMessage(response));
      return decode(await response.json());
    },
    catch: (error) => (error instanceof Error ? error : new Error("Automation request failed")),
  });
}

export function listAutomations(): Effect.Effect<Automation[], Error> {
  return Effect.map(
    requestJson("/api/agent/automations", Schema.decodeUnknownSync(AutomationsResponseSchema)),
    ({ automations }) => [...automations],
  );
}

export function listAutomationModels(): Effect.Effect<AutomationModel[], Error> {
  return Effect.map(
    requestJson("/api/agent/models", Schema.decodeUnknownSync(AgentModelsResponseSchema)),
    ({ models }) => [...models],
  );
}

export function createAutomation(draft: AutomationDraft): Effect.Effect<Automation, Error> {
  return Effect.map(
    requestJson("/api/agent/automations", Schema.decodeUnknownSync(AutomationResponseSchema), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    }),
    ({ automation }) => automation,
  );
}

export function updateAutomation(
  id: string,
  patch: Partial<AutomationDraft> & { status?: Automation["status"]; unread?: boolean },
): Effect.Effect<Automation, Error> {
  return Effect.map(
    requestJson(
      `/api/agent/automations/${encodeURIComponent(id)}`,
      Schema.decodeUnknownSync(AutomationResponseSchema),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    ),
    ({ automation }) => automation,
  );
}

export function deleteAutomation(id: string): Effect.Effect<boolean, Error> {
  return Effect.map(
    requestJson(
      `/api/agent/automations/${encodeURIComponent(id)}`,
      Schema.decodeUnknownSync(DeleteResponseSchema),
      {
        method: "DELETE",
      },
    ),
    ({ ok }) => ok,
  );
}

export function runAutomation(id: string): Effect.Effect<boolean, Error> {
  return Effect.map(
    requestJson(
      `/api/agent/automations/${encodeURIComponent(id)}/run`,
      Schema.decodeUnknownSync(RunResponseSchema),
      {
        method: "POST",
      },
    ),
    ({ started }) => started,
  );
}
