//
// Provider hub: one shared pi ModelRuntime for the whole runtime process.
//
// Owns sign-in to model providers (OAuth and API-key) through pi's provider
// auth: credentials persist to <dataDir>/pi-agent/auth.json — the same
// file/format the pi CLI uses — and OAuth refresh runs inside the store's
// serialized write path at request time. Sessions receive this instance via
// createAgentSessionServices({ modelRuntime }), so a login is live for the
// next turn without a restart.
//
// Login flows are provider-owned and interactive (browser URLs, device codes,
// key prompts). The hub bridges them to HTTP as in-memory jobs: AuthEvents
// append to a log the UI polls, prompts park until the UI responds.
//

import { randomUUID } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type {
  AuthEvent,
  AuthInteraction,
  AuthPrompt,
  AuthType,
  Model,
  Api,
} from "@earendil-works/pi-ai";
import { inferReasoningSupport, type AgentModel } from "../../../shared/agent/models";
import { resolveDataDir } from "./data-dir";
import { getGlobalSingleton } from "./instances";
import type {
  ProviderLoginEvent,
  ProviderLoginEventPayload,
  ProviderLoginJobView,
  ProviderLoginPrompt,
  ProviderView,
} from "./provider-hub-contract";

export type {
  ProviderLoginEvent,
  ProviderLoginJobView,
  ProviderLoginPrompt,
  ProviderView,
} from "./provider-hub-contract";

// Providers composed from Local Studio's own models.json (controllers and
// user-pi passthroughs). They are configured elsewhere; the hub surfaces only
// the pi builtin/cloud providers.
const INTERNAL_PROVIDER_PREFIXES = ["local-studio", "user-pi-"];

const MAX_JOB_EVENTS = 200;
const MAX_FINISHED_JOBS = 8;

type LoginJob = {
  jobId: string;
  providerId: string;
  authType: AuthType;
  status: ProviderLoginJobView["status"];
  error?: string;
  events: ProviderLoginEvent[];
  eventSeq: number;
  promptSeq: number;
  pending: {
    prompt: ProviderLoginPrompt;
    resolve: (value: string) => void;
    reject: (error: Error) => void;
  } | null;
  abort: AbortController;
  finishedAt: number | null;
};

// AuthEvent is already plain data; re-shaping onto the contract union keeps
// the wire format stable if pi adds fields.
function serializeAuthEvent(event: AuthEvent): ProviderLoginEventPayload {
  switch (event.type) {
    case "auth_url":
      return {
        type: "auth_url",
        url: event.url,
        ...(event.instructions ? { instructions: event.instructions } : {}),
      };
    case "device_code":
      return {
        type: "device_code",
        userCode: event.userCode,
        verificationUri: event.verificationUri,
        ...(event.intervalSeconds !== undefined ? { intervalSeconds: event.intervalSeconds } : {}),
        ...(event.expiresInSeconds !== undefined
          ? { expiresInSeconds: event.expiresInSeconds }
          : {}),
      };
    case "progress":
      return { type: "progress", message: event.message };
    default:
      return {
        type: "info",
        message: event.message,
        ...(event.links?.length
          ? { links: event.links.map(({ url, label }) => ({ url, ...(label ? { label } : {}) })) }
          : {}),
      };
  }
}

function isInternalProviderId(id: string): boolean {
  return INTERNAL_PROVIDER_PREFIXES.some((prefix) => id === prefix || id.startsWith(prefix));
}

function agentDirPath(): string {
  return path.join(resolveDataDir(), "pi-agent");
}

async function createHubRuntime(): Promise<ModelRuntime> {
  const agentDir = agentDirPath();
  await mkdir(agentDir, { recursive: true });
  await chmod(agentDir, 0o700).catch(() => undefined);
  const runtime = await ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: path.join(agentDir, "models.json"),
  });
  await registerE2EProviders(runtime);
  return runtime;
}

// Test seam: LOCAL_STUDIO_E2E_PROVIDERS names a module whose default export is
// a map of providerId -> pi ProviderConfigInput (may include a scripted oauth
// implementation). Registered only when the env var is set, so the hermetic
// e2e suite can exercise the real login/token/request pipeline offline.
async function registerE2EProviders(runtime: ModelRuntime): Promise<void> {
  const modulePath = process.env["LOCAL_STUDIO_E2E_PROVIDERS"];
  if (!modulePath) return;
  const imported = (await import(pathToFileURL(modulePath).href)) as {
    default?: Record<string, unknown>;
  };
  for (const [providerId, config] of Object.entries(imported.default ?? {})) {
    runtime.registerProvider(providerId, config as Parameters<ModelRuntime["registerProvider"]>[1]);
  }
}

function hubPromise(): Promise<ModelRuntime> {
  return getGlobalSingleton("providerHubRuntime", createHubRuntime);
}

// The agent-runtime process is the single hub authority: it runs sessions,
// serves the login routes, and owns the ModelRuntime. The Next server also
// bundles this module but must never instantiate pi's runtime — it asks the
// agent runtime over HTTP instead (see pi-runtime-models.ts).
function processRole(): { isAgentRuntime: boolean } {
  return getGlobalSingleton("providerHubProcessRole", () => ({ isAgentRuntime: false }));
}

export function markAgentRuntimeProcess(): void {
  processRole().isAgentRuntime = true;
}

export function isAgentRuntimeProcess(): boolean {
  return processRole().isAgentRuntime;
}

function jobsMap(): Map<string, LoginJob> {
  return getGlobalSingleton("providerHubLoginJobs", () => new Map<string, LoginJob>());
}

export function getProviderHub(): Promise<ModelRuntime> {
  return hubPromise();
}

/** Re-read models.json after Local Studio rewrites it (controller refresh). */
export async function reloadProviderHub(): Promise<void> {
  const runtime = await hubPromise();
  await runtime.reloadConfig();
}

export async function listProviders(): Promise<ProviderView[]> {
  const runtime = await hubPromise();
  const credentials = new Map(
    (await runtime.listCredentials()).map((info) => [info.providerId, info.type]),
  );
  const views: ProviderView[] = [];
  for (const provider of runtime.getProviders()) {
    if (isInternalProviderId(provider.id)) continue;
    const status = runtime.getProviderAuthStatus(provider.id);
    views.push({
      id: provider.id,
      name: provider.name,
      ...(provider.auth.oauth ? { oauth: { label: provider.auth.oauth.name } } : {}),
      ...(provider.auth.apiKey?.login ? { apiKey: { label: provider.auth.apiKey.name } } : {}),
      configured: status.configured,
      ...(status.source ? { authSource: status.source } : {}),
      ...(status.label ? { authLabel: status.label } : {}),
      ...(credentials.has(provider.id)
        ? { credentialType: credentials.get(provider.id) as "oauth" | "api_key" }
        : {}),
      modelCount: runtime.getModels(provider.id).length,
    });
  }
  return views.sort((a, b) => {
    if (a.configured !== b.configured) return a.configured ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function serializePrompt(job: LoginJob, prompt: AuthPrompt): ProviderLoginPrompt {
  job.promptSeq += 1;
  return {
    id: job.promptSeq,
    type: prompt.type,
    message: prompt.message,
    ...("placeholder" in prompt && prompt.placeholder ? { placeholder: prompt.placeholder } : {}),
    ...(prompt.type === "select" ? { options: prompt.options } : {}),
  };
}

function pushEvent(job: LoginJob, event: AuthEvent): void {
  job.eventSeq += 1;
  job.events.push({ seq: job.eventSeq, event: serializeAuthEvent(event) });
  if (job.events.length > MAX_JOB_EVENTS) job.events.splice(0, job.events.length - MAX_JOB_EVENTS);
}

function parkPrompt(job: LoginJob, prompt: AuthPrompt): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const pending = {
      prompt: serializePrompt(job, prompt),
      resolve: (value: string) => {
        cleanup();
        resolve(value);
      },
      reject: (error: Error) => {
        cleanup();
        reject(error);
      },
    };
    const onAbort = () => pending.reject(new Error("Prompt cancelled"));
    const cleanup = () => {
      if (job.pending === pending) job.pending = null;
      prompt.signal?.removeEventListener("abort", onAbort);
    };
    // A login flow awaits one prompt at a time; a still-pending previous
    // prompt means the flow abandoned it (e.g. a callback won a race).
    job.pending?.reject(new Error("Prompt superseded"));
    job.pending = pending;
    prompt.signal?.addEventListener("abort", onAbort);
    if (prompt.signal?.aborted) onAbort();
  });
}

function pruneFinishedJobs(jobs: Map<string, LoginJob>): void {
  const finished = [...jobs.values()]
    .filter((job) => job.finishedAt !== null)
    .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
  while (finished.length > MAX_FINISHED_JOBS) {
    const oldest = finished.shift();
    if (oldest) jobs.delete(oldest.jobId);
  }
}

function finishJob(job: LoginJob, status: LoginJob["status"], error?: string): void {
  if (job.status !== "running") return;
  job.status = status;
  if (error) job.error = error;
  job.finishedAt = Date.now();
  job.pending?.reject(new Error("Login finished"));
}

export async function startProviderLogin(
  providerId: string,
  authType: AuthType,
): Promise<{ jobId: string } | { error: string; status: number }> {
  const runtime = await hubPromise();
  const provider = runtime.getProvider(providerId);
  if (!provider || isInternalProviderId(providerId)) {
    return { error: `Unknown provider '${providerId}'.`, status: 404 };
  }
  const supportsType =
    authType === "oauth" ? Boolean(provider.auth.oauth) : Boolean(provider.auth.apiKey?.login);
  if (!supportsType) {
    return { error: `Provider '${providerId}' does not support ${authType} login.`, status: 400 };
  }
  const jobs = jobsMap();
  for (const existing of jobs.values()) {
    if (existing.providerId === providerId && existing.status === "running") {
      existing.abort.abort();
      finishJob(existing, "cancelled");
    }
  }
  const job: LoginJob = {
    jobId: randomUUID(),
    providerId,
    authType,
    status: "running",
    events: [],
    eventSeq: 0,
    promptSeq: 0,
    pending: null,
    abort: new AbortController(),
    finishedAt: null,
  };
  jobs.set(job.jobId, job);
  pruneFinishedJobs(jobs);

  const interaction: AuthInteraction = {
    signal: job.abort.signal,
    prompt: (prompt) => parkPrompt(job, prompt),
    notify: (event) => pushEvent(job, event),
  };
  void runtime
    .login(providerId, authType, interaction)
    .then(() => finishJob(job, "success"))
    .catch((error: unknown) => {
      if (job.abort.signal.aborted) {
        finishJob(job, "cancelled");
        return;
      }
      finishJob(job, "error", error instanceof Error ? error.message : "Login failed");
    });
  return { jobId: job.jobId };
}

export function getProviderLoginJob(jobId: string, after = 0): ProviderLoginJobView | null {
  const job = jobsMap().get(jobId);
  if (!job) return null;
  return {
    jobId: job.jobId,
    providerId: job.providerId,
    authType: job.authType,
    status: job.status,
    ...(job.error ? { error: job.error } : {}),
    events: job.events.filter((entry) => entry.seq > after),
    ...(job.pending ? { pendingPrompt: job.pending.prompt } : {}),
  };
}

export function respondProviderLogin(jobId: string, promptId: number, value: string): boolean {
  const job = jobsMap().get(jobId);
  if (!job || job.status !== "running") return false;
  const pending = job.pending;
  if (!pending || pending.prompt.id !== promptId) return false;
  pending.resolve(value);
  return true;
}

export function cancelProviderLogin(jobId: string): boolean {
  const job = jobsMap().get(jobId);
  if (!job) return false;
  if (job.status === "running") {
    job.abort.abort();
    finishJob(job, "cancelled");
  }
  return true;
}

export async function logoutProvider(
  providerId: string,
): Promise<{ ok: true } | { error: string; status: number }> {
  const runtime = await hubPromise();
  if (!runtime.getProvider(providerId) || isInternalProviderId(providerId)) {
    return { error: `Unknown provider '${providerId}'.`, status: 404 };
  }
  await runtime.logout(providerId);
  return { ok: true };
}

function providerModelToAgentModel(
  providerId: string,
  providerName: string,
  model: Model<Api>,
): AgentModel {
  return {
    id: `${providerId}/${model.id}`,
    rawId: model.id,
    name: `${model.name} · ${providerName}`,
    provider: "local-studio",
    providerId,
    controllerName: providerName,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    reasoning: model.reasoning || inferReasoningSupport(model.id),
    vision: model.input.includes("image"),
    active: false,
  };
}

/**
 * Models from signed-in cloud providers, shaped for the Local Studio picker.
 * Controller/user-pi providers are excluded — the existing models path owns
 * them. Never throws: providers with broken auth just contribute nothing.
 */
export async function listProviderAgentModels(): Promise<AgentModel[]> {
  try {
    const runtime = await hubPromise();
    const available = await runtime.getAvailable();
    const models: AgentModel[] = [];
    for (const model of available) {
      if (isInternalProviderId(model.provider)) continue;
      const providerName = runtime.getProvider(model.provider)?.name ?? model.provider;
      models.push(providerModelToAgentModel(model.provider, providerName, model));
    }
    return models.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}
