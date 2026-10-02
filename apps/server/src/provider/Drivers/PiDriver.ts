import { OmpSettings, PiAgentSettings } from "@t3tools/contracts";
import type * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";

import type * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makePiTextGeneration } from "../../textGeneration/PiTextGeneration.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makePiAdapter } from "../Layers/PiAdapter.ts";
import {
  buildInitialPiProviderSnapshot,
  checkPiProviderStatus,
  OMP_FLAVOR,
  PI_FLAVOR,
  type PiFlavor,
} from "../Layers/PiProvider.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import { withInstanceIdentity } from "./instanceIdentity.ts";

export type PiDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | Crypto.Crypto
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | ServerConfig
  | ServerSettingsService;

const makePiFamilyDriver = (
  flavor: PiFlavor,
  configSchema: Schema.Codec<PiAgentSettings, unknown>,
): ProviderDriver<PiAgentSettings, PiDriverEnv> => ({
  driverKind: flavor.kind,
  metadata: { displayName: flavor.displayName, supportsMultipleInstances: true },
  configSchema,
  defaultConfig: () => Schema.decodeSync(configSchema)({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const driverKind = flavor.kind;
      const continuationIdentity = defaultProviderContinuationIdentity({ driverKind, instanceId });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        driverKind,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const settings = { ...config, enabled } satisfies PiAgentSettings;
      const snapshotSettings = makeProviderSnapshotSettingsSource(
        settings,
        yield* ServerSettingsService,
      );
      const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<PiAgentSettings>>({
        resolveMaintenance: () =>
          Effect.succeed(
            makeManualOnlyProviderMaintenanceCapabilities({
              provider: driverKind,
              packageName: flavor.npmPackage,
            }),
          ),
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (current) =>
          buildInitialPiProviderSnapshot(flavor, current.provider).pipe(Effect.map(stampIdentity)),
        checkProvider: checkPiProviderStatus(
          flavor,
          settings,
          processEnv,
          (yield* ServerConfig).cwd,
        ).pipe(
          Effect.map(stampIdentity),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        ),
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: driverKind,
              instanceId,
              detail: `Failed to build ${flavor.displayName} snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );
      return {
        instanceId,
        driverKind,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        adapter: yield* makePiAdapter(flavor, settings, { environment: processEnv, instanceId }),
        textGeneration: yield* makePiTextGeneration(flavor, settings, processEnv),
      } satisfies ProviderInstance;
    }),
});

export const PiAgentDriver = makePiFamilyDriver(PI_FLAVOR, PiAgentSettings);
export const OmpDriver = makePiFamilyDriver(OMP_FLAVOR, OmpSettings);
