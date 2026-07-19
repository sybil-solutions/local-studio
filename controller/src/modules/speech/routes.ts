import { Effect, Schema } from "effect";
import type { Logger } from "../../core/logger";
import { effectHandler } from "../../http/effect-handler";
import { documentRoute, mergeRoutes, type ControllerRouteApp } from "../../http/route-registrar";
import {
  boundedFormData,
  readBoundedRequestBody,
  RequestBodyTooLargeError,
} from "../../http/bounded-body";
import { MAX_VOICE_UPLOAD_BYTES, VoiceReferenceError } from "./reference-audio";
import { SpeechServiceError } from "./service";
import type { SpeechInstallInput, SpeechService } from "./service";
import { VOICE_CONSENT_VERSION, VoiceProfileError } from "./voice-store";

const VOICE_REQUEST_LIMIT = MAX_VOICE_UPLOAD_BYTES + 1024 * 1024;
const INSTALL_REQUEST_LIMIT = 1024;
const InstallRequestSchema = Schema.Struct({ repair: Schema.optional(Schema.Boolean) });

type SpeechError = { status: number; code: string; message: string };

export interface SpeechRoutesContext {
  logger: Pick<Logger, "error">;
  speechService: Pick<
    SpeechService,
    | "cancelInstall"
    | "createVoice"
    | "deleteVoice"
    | "getStatus"
    | "install"
    | "listVoices"
    | "stop"
  >;
}

const speechError = (error: unknown): SpeechError | null => {
  if (
    error instanceof SpeechServiceError ||
    error instanceof VoiceReferenceError ||
    error instanceof VoiceProfileError
  ) {
    return { status: error.status, code: error.code, message: error.message };
  }
  if (error instanceof RequestBodyTooLargeError) {
    return {
      status: 413,
      code: "voice_upload_too_large",
      message: "Voice reference must be 20 MB or smaller",
    };
  }
  return null;
};

const errorResponse = (error: SpeechError): Response =>
  Response.json({ code: error.code, error: error.message }, { status: error.status });

const formText = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

const installInput = (request: Request): Effect.Effect<SpeechInstallInput, unknown> =>
  readBoundedRequestBody(request, INSTALL_REQUEST_LIMIT).pipe(
    Effect.mapError((error) =>
      error instanceof RequestBodyTooLargeError
        ? new SpeechServiceError(
            413,
            "speech_install_request_too_large",
            "Install request exceeds 1 KB",
          )
        : error,
    ),
    Effect.flatMap((bytes) => {
      if (!bytes.byteLength) return Effect.succeed({});
      return Effect.try({
        try: () => JSON.parse(new TextDecoder().decode(bytes)),
        catch: () =>
          new SpeechServiceError(400, "speech_install_request_invalid", "Invalid install request"),
      }).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(InstallRequestSchema)),
        Effect.mapError(
          () =>
            new SpeechServiceError(
              400,
              "speech_install_request_invalid",
              "Invalid install request",
            ),
        ),
      );
    }),
  );

const createVoice = (
  context: SpeechRoutesContext,
  request: Request,
): Effect.Effect<Response, unknown> =>
  Effect.gen(function* () {
    const form = yield* boundedFormData(request, VOICE_REQUEST_LIMIT);
    const reference = form.get("reference");
    if (!(reference instanceof File)) {
      return yield* Effect.fail(
        new VoiceProfileError(
          400,
          "voice_reference_required",
          "Multipart field 'reference' is required",
        ),
      );
    }
    if (reference.size > MAX_VOICE_UPLOAD_BYTES) {
      return yield* Effect.fail(
        new VoiceProfileError(
          413,
          "voice_upload_too_large",
          "Voice reference must be 20 MB or smaller",
        ),
      );
    }
    const name = formText(form, "name");
    if (!name || name.length > 80) {
      return yield* Effect.fail(
        new VoiceProfileError(400, "voice_name_invalid", "Voice name must be 1 to 80 characters"),
      );
    }
    const consent = formText(form, "consent");
    if (consent !== VOICE_CONSENT_VERSION) {
      return yield* Effect.fail(
        new VoiceProfileError(
          400,
          "voice_consent_required",
          "Confirm that the recording is your voice before saving it",
        ),
      );
    }
    const audio = yield* Effect.tryPromise({
      try: () => reference.arrayBuffer(),
      catch: (error) => error,
    });
    const voice = yield* context.speechService.createVoice({
      name,
      consent,
      audio: new Uint8Array(audio),
    });
    return Response.json({ voice }, { status: 201 });
  });

const handleSpeechRoute = (
  context: SpeechRoutesContext,
  operation: Effect.Effect<Response, unknown>,
): Effect.Effect<Response> =>
  operation.pipe(
    Effect.catch((error) => {
      const known = speechError(error);
      if (known) return Effect.succeed(errorResponse(known));
      return Effect.sync(() => {
        context.logger.error("speech route failed", { error: String(error) });
        return errorResponse({
          status: 500,
          code: "speech_internal_error",
          message: "Internal speech error",
        });
      });
    }),
  );

export const registerSpeechRoutes = (
  app: ControllerRouteApp,
  context: SpeechRoutesContext,
): ControllerRouteApp => {
  return mergeRoutes(
    app.get(
      "/v1/audio/status",
      documentRoute,
      effectHandler(() =>
        handleSpeechRoute(
          context,
          context.speechService.getStatus().pipe(Effect.map((status) => Response.json({ status }))),
        ),
      ),
    ),
    app.post(
      "/v1/audio/install",
      documentRoute,
      effectHandler((ctx) =>
        handleSpeechRoute(
          context,
          Effect.gen(function* () {
            const status = yield* context.speechService.install(yield* installInput(ctx.req.raw));
            return Response.json(
              { status },
              { status: status.install.phase === "installing" ? 202 : 200 },
            );
          }),
        ),
      ),
    ),
    app.post(
      "/v1/audio/install/cancel",
      documentRoute,
      effectHandler(() =>
        handleSpeechRoute(
          context,
          context.speechService.cancelInstall().pipe(
            Effect.andThen(context.speechService.getStatus()),
            Effect.map((status) => Response.json({ status })),
          ),
        ),
      ),
    ),
    app.get(
      "/v1/audio/voices",
      documentRoute,
      effectHandler(() =>
        handleSpeechRoute(
          context,
          context.speechService
            .listVoices()
            .pipe(Effect.map((voices) => Response.json({ voices }))),
        ),
      ),
    ),
    app.post(
      "/v1/audio/voices",
      documentRoute,
      effectHandler((ctx) => handleSpeechRoute(context, createVoice(context, ctx.req.raw))),
    ),
    app.delete(
      "/v1/audio/voices/:voiceId",
      documentRoute,
      effectHandler((ctx) =>
        handleSpeechRoute(
          context,
          context.speechService.deleteVoice(ctx.req.param("voiceId") ?? "").pipe(
            Effect.map((deleted) =>
              deleted
                ? new Response(null, { status: 204 })
                : errorResponse({
                    status: 404,
                    code: "voice_not_found",
                    message: "Voice profile not found",
                  }),
            ),
          ),
        ),
      ),
    ),
    app.post(
      "/v1/audio/runtime/stop",
      documentRoute,
      effectHandler(() =>
        handleSpeechRoute(
          context,
          context.speechService.stop().pipe(
            Effect.andThen(context.speechService.getStatus()),
            Effect.map((status) => Response.json({ status })),
          ),
        ),
      ),
    ),
  );
};
