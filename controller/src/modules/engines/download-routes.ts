import { Effect } from "effect";
import { notFound } from "../../core/errors";
import { decodeJsonBody } from "../../core/validation";
import { effectHandler } from "../../http/effect-handler";
import { documentRoute, defineRoutes, mergeRoutes } from "../../http/route-registrar";
import { DownloadRequestSchema, DownloadTokenSchema } from "./downloads/download-manager";

const resolveHfToken = (
  ctx: { req: { header: (name: string) => string | undefined } },
  bodyToken?: string | null,
): string | null => {
  const headerToken = ctx.req.header("x-hf-token") ?? ctx.req.header("x-huggingface-token") ?? null;
  const envToken =
    process.env["LOCAL_STUDIO_HF_TOKEN"] ??
    process.env["HF_TOKEN"] ??
    process.env["HUGGINGFACE_TOKEN"] ??
    null;
  return bodyToken || headerToken || envToken;
};

export const registerDownloadRoutes = defineRoutes((app, context) => {
  return mergeRoutes(
    app.get(
      "/studio/downloads",
      documentRoute,
      effectHandler((ctx) =>
        context.downloadManager.list().pipe(Effect.map((downloads) => ctx.json({ downloads }))),
      ),
    ),

    app.get(
      "/studio/downloads/:downloadId",
      documentRoute,
      effectHandler((ctx) =>
        context.downloadManager
          .get(ctx.req.param("downloadId") ?? "")
          .pipe(
            Effect.flatMap((download) =>
              download
                ? Effect.succeed(ctx.json({ download }))
                : Effect.fail(notFound("Download not found")),
            ),
          ),
      ),
    ),

    app.post(
      "/studio/downloads",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const body = yield* decodeJsonBody(ctx, DownloadRequestSchema);
          const download = yield* context.downloadManager.start({
            ...body,
            hf_token: resolveHfToken(ctx, body.hf_token),
          });
          return ctx.json({ download });
        }),
      ),
    ),

    app.post(
      "/studio/downloads/:downloadId/pause",
      documentRoute,
      effectHandler((ctx) =>
        context.downloadManager
          .pause(ctx.req.param("downloadId") ?? "")
          .pipe(Effect.map((download) => ctx.json({ download }))),
      ),
    ),

    app.post(
      "/studio/downloads/:downloadId/resume",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const body = yield* decodeJsonBody(ctx, DownloadTokenSchema);
          const download = yield* context.downloadManager.resume(
            ctx.req.param("downloadId") ?? "",
            resolveHfToken(ctx, body.hf_token),
          );
          return ctx.json({ download });
        }),
      ),
    ),

    app.post(
      "/studio/downloads/:downloadId/cancel",
      documentRoute,
      effectHandler((ctx) =>
        context.downloadManager
          .cancel(ctx.req.param("downloadId") ?? "")
          .pipe(Effect.map((download) => ctx.json({ download }))),
      ),
    ),
  );
});
