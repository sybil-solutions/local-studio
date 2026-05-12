import type { EngineBackend, RuntimeTarget } from "../../shared/system-types";
import {
  getVllmUpgradeVersion,
  isUpgradeCommandConfigured,
  LLAMACPP_UPGRADE_ENV,
  VLLM_UPGRADE_VERSION_ENV,
} from "./upgrade-config";

type RuntimeTargetSource = RuntimeTarget["source"];
type RuntimeTargetKind = RuntimeTarget["kind"];
type RuntimeHealthStatus = RuntimeTarget["health"]["status"];

const normalizeIdPart = (value: string): string =>
  Buffer.from(value).toString("base64url").replace(/=+$/g, "");

const targetId = (backend: EngineBackend, kind: RuntimeTargetKind, key: string): string =>
  `${backend}:${kind}:${normalizeIdPart(key)}`;

const createCapabilities = (target: {
  kind: RuntimeTargetKind;
  backend: EngineBackend;
  installed: boolean;
  source: RuntimeTargetSource;
  pythonPath?: string | null;
}): RuntimeTarget["capabilities"] => ({
  canLaunch: target.installed || target.source === "running",
  canUpdate:
    (target.backend === "vllm" &&
      target.installed &&
      (target.kind === "venv" || (target.kind === "system" && Boolean(target.pythonPath)))) ||
    (target.backend === "llamacpp" && isUpgradeCommandConfigured(LLAMACPP_UPGRADE_ENV)),
  canInspectOptions:
    target.backend !== "sglang" && (target.installed || target.source === "running"),
  supportsDocker: target.kind === "docker",
});

const createHealth = (
  installed: boolean,
  source: RuntimeTargetSource,
  message?: string
): RuntimeTarget["health"] => {
  let status: RuntimeHealthStatus = installed ? "ok" : "warning";
  if (source === "running") status = "ok";
  if (message && !installed && source !== "running") status = "warning";
  return message ? { status, message } : { status };
};

const RELEASE_NOTES: Record<EngineBackend, string> = {
  vllm: "https://github.com/vllm-project/vllm/releases",
  sglang: "https://github.com/sgl-project/sglang/releases",
  llamacpp: "https://github.com/ggml-org/llama.cpp/releases",
};

const packageSpecForTarget = (backend: EngineBackend): string => {
  if (backend === "vllm") {
    const target = getVllmUpgradeVersion().trim();
    return target ? `vllm==${target}` : "vllm";
  }
  if (backend === "sglang") return "sglang";
  return "configured llama.cpp upgrade command";
};

const updateMetadata = (args: {
  backend: EngineBackend;
  version?: string | null | undefined;
  capabilities: RuntimeTarget["capabilities"];
}): RuntimeTarget["update"] | undefined => {
  if (!args.capabilities.canUpdate) return undefined;
  const configuredVllmTarget = args.backend === "vllm" ? getVllmUpgradeVersion().trim() : "";
  const targetVersion =
    args.backend === "vllm" && configuredVllmTarget
      ? configuredVllmTarget
      : args.backend === "llamacpp"
        ? "configured"
        : "latest";
  return {
    currentVersion: args.version ?? null,
    targetVersion,
    packageSpec: packageSpecForTarget(args.backend),
    releaseNotesUrl: RELEASE_NOTES[args.backend],
    restartRequired: true,
    changes: [
      `${args.backend} runtime package/binary`,
      "Controller runtime target metadata after completion",
      "Running model process after restart/reload",
      ...(args.backend === "vllm" && !configuredVllmTarget
        ? [`Set ${VLLM_UPGRADE_VERSION_ENV} to pin a specific target version.`]
        : []),
    ],
  };
};

export const makeRuntimeTarget = (args: {
  backend: EngineBackend;
  kind: RuntimeTargetKind;
  source: RuntimeTargetSource;
  key: string;
  label: string;
  installed: boolean;
  active?: boolean;
  version?: string | null;
  pythonPath?: string | null;
  binaryPath?: string | null;
  dockerImage?: string | null;
  healthMessage?: string | undefined;
}): RuntimeTarget => {
  const base = {
    backend: args.backend,
    kind: args.kind,
    installed: args.installed,
    source: args.source,
    ...(args.pythonPath !== undefined ? { pythonPath: args.pythonPath } : {}),
  };
  const capabilities = createCapabilities(base);
  const update = updateMetadata({
    backend: args.backend,
    version: args.version,
    capabilities,
  });
  return {
    id: targetId(args.backend, args.kind, args.key),
    backend: args.backend,
    kind: args.kind,
    label: args.label,
    installed: args.installed,
    active: args.active ?? false,
    version: args.version ?? null,
    pythonPath: args.pythonPath ?? null,
    binaryPath: args.binaryPath ?? null,
    dockerImage: args.dockerImage ?? null,
    source: args.source,
    capabilities,
    health: createHealth(args.installed, args.source, args.healthMessage),
    ...(update ? { update } : {}),
  };
};
