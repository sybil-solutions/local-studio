import { type ModelSelection, type PiAgentSettings, TextGenerationError } from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import { extractJsonObject } from "@t3tools/shared/schemaJson";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";

import { asRecord, asString, spawnPiRpc } from "../provider/Layers/PiRpc.ts";
import {
  REASONING_OPTION_ID,
  splitModelSlug,
  type PiFlavor,
} from "../provider/Layers/PiProvider.ts";
import * as TextGeneration from "./TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "./TextGenerationUtils.ts";

const PI_TIMEOUT_MS = 180_000;

const isTextGenerationError = Schema.is(TextGenerationError);

type Operation = keyof TextGeneration.TextGeneration["Service"];

export const makePiTextGeneration = Effect.fn("makePiTextGeneration")(function* (
  flavor: PiFlavor,
  settings: PiAgentSettings,
  environment: NodeJS.ProcessEnv,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const runPiJson = <S extends Schema.Top>(input: {
    readonly operation: Operation;
    readonly cwd: string;
    readonly prompt: string;
    readonly outputSchema: S;
    readonly modelSelection: ModelSelection;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
    Effect.gen(function* () {
      const settled = yield* Deferred.make<void, string>();
      const rpc = yield* spawnPiRpc({
        provider: flavor.kind,
        command: settings.binaryPath || flavor.binary,
        args: ["--mode", "rpc", ...flavor.headlessArgs, "--no-tools"],
        cwd: input.cwd,
        env: environment,
        onFrame: (frame) =>
          frame.type === flavor.settleEvent ? Deferred.succeed(settled, undefined) : Effect.void,
        onExit: (reason) => Deferred.fail(settled, reason),
      }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));

      const parts = splitModelSlug(input.modelSelection.model);
      if (parts) yield* rpc.request({ type: "set_model", ...parts });
      const effort = getModelSelectionStringOptionValue(input.modelSelection, REASONING_OPTION_ID);
      if (effort) yield* rpc.request({ type: "set_thinking_level", level: effort });

      yield* rpc.request({ type: "prompt", message: input.prompt });
      yield* Deferred.await(settled).pipe(Effect.timeout(PI_TIMEOUT_MS));
      const response = yield* rpc.request({ type: "get_last_assistant_text" });
      const text = asString(asRecord(response.data).text)?.trim();
      if (!text) {
        return yield* new TextGenerationError({
          operation: input.operation,
          detail: `${flavor.displayName} returned empty output.`,
        });
      }
      return yield* Schema.decodeEffect(Schema.fromJsonString(input.outputSchema))(
        extractJsonObject(text),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isTextGenerationError(cause)
          ? cause
          : new TextGenerationError({
              operation: input.operation,
              detail: `${flavor.displayName} text generation failed.`,
              cause,
            }),
      ),
      Effect.scoped,
    ) as Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]>;

  const generate = <S extends Schema.Top, A>(
    operation: Operation,
    input: { readonly cwd: string; readonly modelSelection: ModelSelection },
    built: { readonly prompt: string; readonly outputSchema: S },
    finish: (generated: S["Type"]) => A,
  ) =>
    runPiJson({ operation, ...input, ...built }).pipe(Effect.map(finish));

  return {
    generateCommitMessage: (input) =>
      generate(
        "generateCommitMessage",
        input,
        buildCommitMessagePrompt({ ...input, includeBranch: input.includeBranch === true }),
        (generated) => ({
          subject: sanitizeCommitSubject(generated.subject),
          body: generated.body.trim(),
          ...("branch" in generated && typeof generated.branch === "string"
            ? { branch: sanitizeFeatureBranchName(generated.branch) }
            : {}),
        }),
      ),
    generatePrContent: (input) =>
      generate(
        "generatePrContent",
        input,
        buildPrContentPrompt(input),
        (generated) => ({
          title: sanitizePrTitle(generated.title),
          body: generated.body.trim(),
        }),
      ),
    generateBranchName: (input) =>
      generate(
        "generateBranchName",
        input,
        buildBranchNamePrompt(input),
        (generated) => ({ branch: sanitizeBranchFragment(generated.branch) }),
      ),
    generateThreadTitle: (input) =>
      generate(
        "generateThreadTitle",
        input,
        buildThreadTitlePrompt(input),
        (generated) =>
          ({
            title: sanitizeThreadTitle(generated.title),
            ...(generated.needsRefinement ? { needsRefinement: true } : {}),
          }) satisfies TextGeneration.ThreadTitleGenerationResult,
      ),
  } satisfies TextGeneration.TextGeneration["Service"];
});
