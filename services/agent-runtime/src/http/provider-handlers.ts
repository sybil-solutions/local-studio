//
// HTTP surface for the provider hub. All routes are proxied through the Next
// server (`/api/agent/providers*`) like the other runtime handlers, so the
// hub's single ModelRuntime instance serves both sign-in and sessions.
//

import {
  cancelProviderLogin,
  getProviderLoginJob,
  listProviderAgentModels,
  listProviders,
  logoutProvider,
  reloadProviderHub,
  respondProviderLogin,
  startProviderLogin,
} from "../provider-hub";
import { errorMessage, jsonError } from "./helpers";

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = (await request.json()) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function handleProvidersList(): Promise<Response> {
  try {
    return Response.json({ providers: await listProviders() });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to list providers."), 500);
  }
}

/**
 * Provider models for the picker, served from the hub's home process. The
 * Next server calls this instead of instantiating its own ModelRuntime.
 * models.json may have just been rewritten by the caller, so re-read first.
 */
export async function handleProviderModels(): Promise<Response> {
  try {
    await reloadProviderHub().catch(() => undefined);
    return Response.json({ models: await listProviderAgentModels() });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to list provider models."), 500);
  }
}

export async function handleProviderLogin(request: Request, providerId: string): Promise<Response> {
  const body = await readJsonBody(request);
  const authType = body?.type === "api_key" ? "api_key" : body?.type === "oauth" ? "oauth" : null;
  if (!authType) return jsonError("Body must include type: \"oauth\" | \"api_key\".");
  try {
    const result = await startProviderLogin(providerId, authType);
    if ("error" in result) return jsonError(result.error, result.status);
    return Response.json(result);
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to start login."), 500);
  }
}

export function handleProviderLoginJob(request: Request, jobId: string): Response {
  const after = Number(new URL(request.url).searchParams.get("after") ?? "0");
  const job = getProviderLoginJob(jobId, Number.isFinite(after) ? after : 0);
  if (!job) return jsonError(`Unknown login job '${jobId}'.`, 404);
  return Response.json(job);
}

export async function handleProviderLoginRespond(
  request: Request,
  jobId: string,
): Promise<Response> {
  const body = await readJsonBody(request);
  const promptId = typeof body?.promptId === "number" ? body.promptId : null;
  const value = typeof body?.value === "string" ? body.value : null;
  if (promptId === null || value === null) {
    return jsonError("Body must include promptId (number) and value (string).");
  }
  if (!respondProviderLogin(jobId, promptId, value)) {
    return jsonError("No matching pending prompt for this job.", 409);
  }
  return Response.json({ ok: true });
}

export function handleProviderLoginCancel(jobId: string): Response {
  if (!cancelProviderLogin(jobId)) return jsonError(`Unknown login job '${jobId}'.`, 404);
  return Response.json({ ok: true });
}

export async function handleProviderLogout(providerId: string): Promise<Response> {
  try {
    const result = await logoutProvider(providerId);
    if ("error" in result) return jsonError(result.error, result.status);
    return Response.json(result);
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to sign out."), 500);
  }
}
