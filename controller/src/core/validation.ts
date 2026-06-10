import { badRequest } from "./errors";

type JsonBodyCtx = { req: { json: () => Promise<unknown> } };

/**
 * Parse a JSON request body, tolerating an empty/invalid body, and require a
 * plain object. The standard guard used by mutating routes; throws the same
 * `badRequest("Invalid payload")` the routes previously raised inline.
 */
export const parseJsonObjectBody = async (ctx: JsonBodyCtx): Promise<Record<string, unknown>> => {
  const body = await ctx.req.json().catch(() => ({}));
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Invalid payload");
  }
  return body as Record<string, unknown>;
};

export const optionalString = (
  record: Record<string, unknown>,
  key: string,
): string | undefined => (typeof record[key] === "string" ? (record[key] as string) : undefined);

/**
 * Optional string-array field. Matches the historical inline guards:
 * non-array values are treated as absent; an array containing non-string
 * entries is rejected.
 */
export const optionalStringArray = (
  record: Record<string, unknown>,
  key: string,
): string[] | undefined => {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  if (value.some((entry) => typeof entry !== "string")) {
    throw badRequest(`${key} must be an array of strings`);
  }
  return value as string[];
};

/**
 * Optional string-enum field. Matches the historical inline guards: values
 * that are missing, non-string, or empty are treated as absent; only a
 * non-empty string outside `values` is rejected.
 */
export const optionalEnum = <T extends string>(
  record: Record<string, unknown>,
  key: string,
  values: readonly T[],
  label?: string,
): T | undefined => {
  const value = optionalString(record, key);
  if (!value) return undefined;
  if (!values.includes(value as T)) throw badRequest(`Invalid ${label ?? key}`);
  return value as T;
};

/** Interpret env-var style truthy strings ("1", "true", "yes", "on"). */
export const parseBooleanFlag = (raw: unknown): boolean => {
  if (typeof raw === "boolean") return raw;
  if (raw === undefined || raw === null) return false;
  const normalized = String(raw).trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
};
