import {
  PI_DEFAULT_MODEL,
  ProviderDriverKind,
  type CustomModelSetting,
  type PiAgentSettings,
  type RuntimeMode,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  buildSelectOptionDescriptor,
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import { asRecord, asString, spawnPiRpc } from "./PiRpc.ts";

export interface PiFlavor {
  readonly kind: ProviderDriverKind;
  readonly displayName: string;
  readonly binary: string;
  readonly npmPackage: string;
  readonly resumeFlag: string;
  readonly settleEvent: string;
  readonly approvalArgs: (mode: RuntimeMode) => ReadonlyArray<string>;
  readonly headlessArgs: ReadonlyArray<string>;
}

export const PI_FLAVOR: PiFlavor = {
  kind: ProviderDriverKind.make("piAgent"),
  displayName: "Pi",
  binary: "pi",
  npmPackage: "@earendil-works/pi-coding-agent",
  resumeFlag: "--session",
  settleEvent: "agent_settled",
  approvalArgs: () => [],
  headlessArgs: ["--no-session", "--no-extensions", "--offline"],
};

const OMP_APPROVAL_MODE: Record<RuntimeMode, string> = {
  "approval-required": "always-ask",
  "auto-accept-edits": "write",
  auto: "write",
  "full-access": "yolo",
};

export const OMP_FLAVOR: PiFlavor = {
  kind: ProviderDriverKind.make("omp"),
  displayName: "Oh My Pi",
  binary: "omp",
  npmPackage: "@oh-my-pi/pi-coding-agent",
  resumeFlag: "--resume",
  settleEvent: "session_settled",
  approvalArgs: (mode) => ["--approval-mode", OMP_APPROVAL_MODE[mode]],
  headlessArgs: ["--no-session", "--no-extensions"],
};

export const REASONING_OPTION_ID = "reasoningEffort";
const DEFAULT_EFFORTS = ["minimal", "low", "medium", "high"];
const VERSION_PROBE_TIMEOUT_MS = 4_000;
const MODEL_PROBE_TIMEOUT_MS = 15_000;

const presentation = (flavor: PiFlavor) =>
  ({
    displayName: flavor.displayName,
    supportsConversationRollback: false,
    showInteractionModeToggle: false,
    reportsContextWindow: true,
  }) as const;

const NO_OPTIONS = createModelCapabilities({ optionDescriptors: [] });

const DEFAULT_MODEL: ServerProviderModel = {
  slug: PI_DEFAULT_MODEL,
  name: "Harness default",
  isCustom: false,
  capabilities: NO_OPTIONS,
};

export const splitModelSlug = (slug: string) => {
  const index = slug.indexOf("/");
  return index > 0 ? { provider: slug.slice(0, index), modelId: slug.slice(index + 1) } : undefined;
};

const modelFromRpc = (raw: unknown): ServerProviderModel | undefined => {
  const model = asRecord(raw);
  const provider = asString(model.provider);
  const id = asString(model.id);
  if (!provider || !id) return undefined;
  const reported = asRecord(model.thinking).efforts;
  const efforts = Array.isArray(reported)
    ? reported.filter((effort): effort is string => typeof effort === "string")
    : model.reasoning === true
      ? DEFAULT_EFFORTS
      : [];
  return {
    slug: `${provider}/${id}`,
    name: asString(model.name) ?? id,
    subProvider: provider,
    isCustom: false,
    capabilities: createModelCapabilities({
      optionDescriptors:
        efforts.length > 0
          ? [
              buildSelectOptionDescriptor({
                id: REASONING_OPTION_ID,
                label: "Reasoning",
                options: ["off", ...efforts].map((value) => ({ value, label: value })),
              }),
            ]
          : [],
    }),
  };
};

const modelsFromSettings = (
  discovered: ReadonlyArray<ServerProviderModel>,
  customModels: ReadonlyArray<CustomModelSetting>,
) => providerModelsFromSettings([DEFAULT_MODEL, ...discovered], customModels, NO_OPTIONS);

export const buildInitialPiProviderSnapshot = (
  flavor: PiFlavor,
  settings: PiAgentSettings,
): Effect.Effect<ServerProviderDraft> =>
  Effect.map(DateTime.now, (now) =>
    buildServerProvider({
      presentation: presentation(flavor),
      enabled: settings.enabled,
      checkedAt: DateTime.formatIso(now),
      models: modelsFromSettings([], settings.customModels),
      probe: {
        installed: settings.enabled,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: settings.enabled
          ? `Checking ${flavor.displayName} CLI availability...`
          : `${flavor.displayName} is disabled in T3 Code settings.`,
      },
    }),
  );

const listModels = (
  flavor: PiFlavor,
  command: string,
  environment: NodeJS.ProcessEnv,
  cwd: string,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const rpc = yield* spawnPiRpc({
        provider: flavor.kind,
        command,
        args: ["--mode", "rpc", ...flavor.headlessArgs],
        cwd,
        env: environment,
        onFrame: () => Effect.void,
        onExit: () => Effect.void,
      });
      const response = yield* rpc.request({ type: "get_available_models" }, MODEL_PROBE_TIMEOUT_MS);
      const models = asRecord(response.data).models;
      return (Array.isArray(models) ? models : []).flatMap((raw) => modelFromRpc(raw) ?? []);
    }),
  );

export const checkPiProviderStatus = Effect.fn("checkPiProviderStatus")(function* (
  flavor: PiFlavor,
  settings: PiAgentSettings,
  environment: NodeJS.ProcessEnv,
  cwd: string,
): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const command = settings.binaryPath || flavor.binary;
  const draft = (
    probe: Parameters<typeof buildServerProvider>[0]["probe"],
    models: ReadonlyArray<ServerProviderModel> = [],
  ) =>
    buildServerProvider({
      presentation: presentation(flavor),
      enabled: settings.enabled,
      checkedAt,
      models: modelsFromSettings(models, settings.customModels),
      probe,
    });

  if (!settings.enabled) {
    return draft({
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: `${flavor.displayName} is disabled in T3 Code settings.`,
    });
  }

  const spawnCommand = yield* resolveSpawnCommand(command, ["--version"], { env: environment });
  const versionResult = yield* spawnAndCollect(
    command,
    ChildProcess.make(spawnCommand.command, spawnCommand.args, {
      env: environment,
      shell: spawnCommand.shell,
    }),
  ).pipe(Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS), Effect.result);

  const output =
    Result.isSuccess(versionResult) &&
    Option.isSome(versionResult.success) &&
    versionResult.success.value.code === 0
      ? versionResult.success.value
      : undefined;
  if (!output) {
    const missing = Result.isFailure(versionResult) && isCommandMissingCause(versionResult.failure);
    return draft({
      installed: !missing,
      version: null,
      status: "error",
      auth: { status: "unknown" },
      message: missing
        ? `${flavor.displayName} CLI (\`${command}\`) is not installed or not on PATH.`
        : `Failed to run \`${command} --version\`.`,
    });
  }

  const version = parseGenericCliVersion(`${output.stdout}\n${output.stderr}`);
  const discovered = yield* listModels(flavor, command, environment, cwd).pipe(
    Effect.orElseSucceed(() => undefined),
  );
  if (!discovered) {
    return draft({
      installed: true,
      version,
      status: "warning",
      auth: { status: "unknown" },
      message: `Could not list ${flavor.displayName} models. Custom models still work.`,
    });
  }

  if (discovered.length === 0) {
    return draft({
      installed: true,
      version,
      status: "error",
      auth: { status: "unauthenticated" },
      message: `${flavor.displayName} has no usable models. Run \`${command}\` and use /login to add a provider.`,
    });
  }

  return draft(
    { installed: true, version, status: "ready", auth: { status: "authenticated" } },
    discovered,
  );
});
