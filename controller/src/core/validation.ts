import { Effect, Schema } from "effect";
import { badRequest } from "./errors";

type JsonBodyContext = { req: { raw: Pick<Request, "json"> } };

const readJsonBody = (ctx: JsonBodyContext): Effect.Effect<unknown> =>
  Effect.tryPromise({
    try: () => ctx.req.raw.json(),
    catch: () => badRequest("Invalid payload"),
  }).pipe(Effect.catch(() => Effect.succeed({})));

export const decodeJsonBody = <A>(
  ctx: JsonBodyContext,
  schema: Schema.Codec<A, unknown, never, unknown>,
): Effect.Effect<A, ReturnType<typeof badRequest>> =>
  readJsonBody(ctx).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError(() => badRequest("Invalid payload")),
  );

export const parseBooleanFlag = (raw: unknown): boolean => {
  if (typeof raw === "boolean") return raw;
  if (raw === undefined || raw === null) return false;
  const normalized = String(raw).trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
};
