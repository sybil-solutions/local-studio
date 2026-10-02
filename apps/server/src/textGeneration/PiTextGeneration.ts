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
import type * as TextGeneration from "./TextGeneration.ts";
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

const isTextGenerationError = Schema.is(TextGenerationError);

export const makePiTextGeneration = Effect.fn("makePiTextGeneration")(function* (
  flavor: PiFlavor,
  settings: PiAgentSettings,
  environment: NodeJS.ProcessEnv,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const generate = <S extends Schema.Top, A>(
    operation: keyof TextGeneration.TextGeneration["Service"],
    input: { readonly cwd: string; readonly modelSelection: ModelSelection },
    built: { readonly prompt: string; readonly outputSchema: S },
    finish: (generated: S["Type"]) => A,
  ) =>
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
      yield* rpc.request({ type: "prompt", message: built.prompt });
      yield* Deferred.await(settled).pipe(Effect.timeout(180_000));
      const text = asString(
        asRecord((yield* rpc.request({ type: "get_last_assistant_text" })).data).text,
      )?.trim();
      if (!text) {
        return yield* new TextGenerationError({
          operation,
          detail: `${flavor.displayName} returned empty output.`,
        });
      }
      return finish(
        yield* Schema.decodeEffect(Schema.fromJsonString(built.outputSchema))(
          extractJsonObject(text),
        ),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isTextGenerationError(cause)
          ? cause
          : new TextGenerationError({
              operation,
              detail: `${flavor.displayName} text generation failed.`,
              cause,
            }),
      ),
      Effect.scoped,
    ) as Effect.Effect<A, TextGenerationError, S["DecodingServices"]>;

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
      generate("generatePrContent", input, buildPrContentPrompt(input), (generated) => ({
        title: sanitizePrTitle(generated.title),
        body: generated.body.trim(),
      })),
    generateBranchName: (input) =>
      generate("generateBranchName", input, buildBranchNamePrompt(input), (generated) => ({
        branch: sanitizeBranchFragment(generated.branch),
      })),
    generateThreadTitle: (input) =>
      generate(
        "generateThreadTitle",
        input,
        buildThreadTitlePrompt(input),
        (generated): TextGeneration.ThreadTitleGenerationResult => ({
          title: sanitizeThreadTitle(generated.title),
          ...(generated.needsRefinement ? { needsRefinement: true } : {}),
        }),
      ),
  } satisfies TextGeneration.TextGeneration["Service"];
});
