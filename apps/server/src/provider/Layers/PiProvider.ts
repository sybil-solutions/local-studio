import {
  PI_DEFAULT_MODEL,
  ProviderDriverKind,
  type PiAgentSettings,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  buildSelectOptionDescriptor,
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ProviderProbeResult,
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
  readonly sessionArgs: ReadonlyArray<string>;
  readonly headlessArgs: ReadonlyArray<string>;
}

export const PI_FLAVOR: PiFlavor = {
  kind: ProviderDriverKind.make("piAgent"),
  displayName: "Pi",
  binary: "pi",
  npmPackage: "@earendil-works/pi-coding-agent",
  resumeFlag: "--session",
  settleEvent: "agent_settled",
  sessionArgs: [],
  headlessArgs: ["--no-session", "--no-extensions", "--offline"],
};

export const OMP_FLAVOR: PiFlavor = {
  kind: ProviderDriverKind.make("omp"),
  displayName: "Oh My Pi",
  binary: "omp",
  npmPackage: "@oh-my-pi/pi-coding-agent",
  resumeFlag: "--resume",
  settleEvent: "session_settled",
  sessionArgs: ["--auto-approve"],
  headlessArgs: ["--no-session", "--no-extensions"],
};

export const REASONING_OPTION_ID = "reasoningEffort";
const NO_OPTIONS = createModelCapabilities({ optionDescriptors: [] });

export const splitModelSlug = (slug: string) => {
  const index = slug.indexOf("/");
  return index > 0 ? { provider: slug.slice(0, index), modelId: slug.slice(index + 1) } : undefined;
};

const modelFromRpc = (raw: unknown): ServerProviderModel[] => {
  const model = asRecord(raw);
  const provider = asString(model.provider);
  const id = asString(model.id);
  const reported = asRecord(model.thinking).efforts;
  const efforts = Array.isArray(reported)
    ? reported.filter((effort): effort is string => typeof effort === "string")
    : model.reasoning === true
      ? ["minimal", "low", "medium", "high"]
      : [];
  const options = ["off", ...efforts].map((value) => ({ value, label: value }));
  const reasoning = buildSelectOptionDescriptor({
    id: REASONING_OPTION_ID,
    label: "Reasoning",
    options,
  });
  if (!provider || !id) return [];
  return [
    {
      slug: `${provider}/${id}`,
      name: asString(model.name) ?? id,
      subProvider: provider,
      isCustom: false,
      capabilities: createModelCapabilities({
        optionDescriptors: efforts.length > 0 ? [reasoning] : [],
      }),
    },
  ];
};

const draft = (
  flavor: PiFlavor,
  settings: PiAgentSettings,
  checkedAt: string,
  probe: ProviderProbeResult,
  models: ReadonlyArray<ServerProviderModel> = [],
): ServerProviderDraft =>
  buildServerProvider({
    presentation: {
      displayName: flavor.displayName,
      supportsConversationRollback: false,
      showInteractionModeToggle: false,
      reportsContextWindow: true,
    },
    enabled: settings.enabled,
    checkedAt,
    models: providerModelsFromSettings(
      [
        {
          slug: PI_DEFAULT_MODEL,
          name: "Harness default",
          isCustom: false,
          capabilities: NO_OPTIONS,
        },
        ...models,
      ],
      settings.customModels,
      NO_OPTIONS,
    ),
    probe,
  });

const unknownAuth = { status: "unknown" } as const;
const disabled = (flavor: PiFlavor) => `${flavor.displayName} is disabled in T3 Code settings.`;

export const buildInitialPiProviderSnapshot = (flavor: PiFlavor, settings: PiAgentSettings) =>
  Effect.map(DateTime.now, (now) =>
    draft(flavor, settings, DateTime.formatIso(now), {
      installed: settings.enabled,
      version: null,
      status: "warning",
      auth: unknownAuth,
      message: settings.enabled
        ? `Checking ${flavor.displayName} CLI availability...`
        : disabled(flavor),
    }),
  );

export const checkPiProviderStatus = Effect.fn("checkPiProviderStatus")(function* (
  flavor: PiFlavor,
  settings: PiAgentSettings,
  env: NodeJS.ProcessEnv,
  cwd: string,
): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const command = settings.binaryPath || flavor.binary;
  const result = (probe: ProviderProbeResult, models?: ReadonlyArray<ServerProviderModel>) =>
    draft(flavor, settings, checkedAt, probe, models);
  if (!settings.enabled) {
    return result({
      installed: false,
      version: null,
      status: "warning",
      auth: unknownAuth,
      message: disabled(flavor),
    });
  }

  const spawnCommand = yield* resolveSpawnCommand(command, ["--version"], { env });
  const versionResult = yield* spawnAndCollect(
    command,
    ChildProcess.make(spawnCommand.command, spawnCommand.args, { env, shell: spawnCommand.shell }),
  ).pipe(Effect.timeout(4_000), Effect.result);
  if (versionResult._tag === "Failure" || versionResult.success.code !== 0) {
    const missing =
      versionResult._tag === "Failure" && isCommandMissingCause(versionResult.failure);
    return result({
      installed: !missing,
      version: null,
      status: "error",
      auth: unknownAuth,
      message: missing
        ? `${flavor.displayName} CLI (\`${command}\`) is not installed or not on PATH.`
        : `Failed to run \`${command} --version\`.`,
    });
  }

  const version = parseGenericCliVersion(
    `${versionResult.success.stdout}\n${versionResult.success.stderr}`,
  );
  const discovered = yield* Effect.scoped(
    Effect.gen(function* () {
      const rpc = yield* spawnPiRpc({
        provider: flavor.kind,
        command,
        args: ["--mode", "rpc", ...flavor.headlessArgs],
        cwd,
        env,
        onFrame: () => Effect.void,
        onExit: () => Effect.void,
      });
      const models = asRecord(
        (yield* rpc.request({ type: "get_available_models" }, 15_000)).data,
      ).models;
      return (Array.isArray(models) ? models : []).flatMap(modelFromRpc);
    }),
  ).pipe(Effect.orElseSucceed(() => undefined));
  if (!discovered) {
    return result({
      installed: true,
      version,
      status: "warning",
      auth: unknownAuth,
      message: `Could not list ${flavor.displayName} models. Custom models still work.`,
    });
  }
  return discovered.length === 0
    ? result({
        installed: true,
        version,
        status: "error",
        auth: { status: "unauthenticated" },
        message: `${flavor.displayName} has no usable models. Run \`${command}\` and use /login to add a provider.`,
      })
    : result(
        { installed: true, version, status: "ready", auth: { status: "authenticated" } },
        discovered,
      );
});
