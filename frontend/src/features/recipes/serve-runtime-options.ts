import type { Backend, RuntimeTarget, ServeRuntime, ServeRuntimeKind } from "@/lib/types";
import {
  defaultRuntimeForBackend,
  isManagedServeRuntimeTarget,
  runtimeId,
} from "@/lib/serve-runtime";
import { ENGINE_LABEL } from "./engine-capabilities";

export { defaultRuntimeForBackend, runtimeId } from "@/lib/serve-runtime";

export interface ServeRuntimeOption {
  id: string;
  targetId?: string;
  label: string;
  detail: string;
  runtime: ServeRuntime;
  installed: boolean;
  canInstall: boolean;
  version: string | null;
}

const targetReference = (target: RuntimeTarget): string | null => {
  if (target.kind === "wsl2") return target.wslDistribution ?? null;
  if (target.kind === "docker") return target.dockerImage ?? null;
  if (target.kind === "binary") return target.binaryPath ?? null;
  return target.binaryPath ?? target.pythonPath ?? null;
};

const runtimeKindForTarget = (target: RuntimeTarget): ServeRuntimeKind => {
  if (target.kind === "wsl2") return "wsl2";
  if (target.kind === "docker") return "docker";
  if (target.kind === "binary") return "binary";
  return "system";
};

const optionFromTarget = (target: RuntimeTarget): ServeRuntimeOption | null => {
  const reference = targetReference(target);
  if (!reference || target.source === "bundled") return null;
  const runtime = {
    kind: runtimeKindForTarget(target),
    ref: reference,
    ...(target.kind === "wsl2" && target.binaryPath ? { binary: target.binaryPath } : {}),
    label: target.label,
  } satisfies ServeRuntime;
  return {
    id: runtimeId(runtime),
    targetId: target.id,
    label: target.label,
    detail:
      target.kind === "wsl2"
        ? `WSL2 · ${reference} · ${target.installed ? (target.version ?? "installed") : "install required"}`
        : [target.kind, target.source, target.version].filter(Boolean).join(" · "),
    runtime,
    installed: target.installed,
    canInstall: target.capabilities.canInstall,
    version: target.version,
  };
};

export const runtimeOptionsFor = (
  backend: Backend,
  targets: RuntimeTarget[],
): ServeRuntimeOption[] => {
  const defaultRuntime = defaultRuntimeForBackend(backend);
  const hasWslRuntime = targets.some(
    (target) => target.backend === backend && target.kind === "wsl2",
  );
  const managed = targets.find((target) => isManagedServeRuntimeTarget(backend, target));
  const options: ServeRuntimeOption[] = hasWslRuntime
    ? []
    : [
        {
          id: runtimeId(defaultRuntime),
          label: defaultRuntime.label ?? `Managed ${ENGINE_LABEL[backend]}`,
          detail: managed?.version
            ? `managed venv · ${managed.version}`
            : "managed by Local Studio",
          runtime: defaultRuntime,
          installed: backend === "llamacpp" ? Boolean(managed) : Boolean(managed?.installed),
          canInstall: backend !== "llamacpp" && !managed?.installed,
          version: managed?.version ?? null,
        },
      ];
  const seen = new Set(options.map((option) => option.id));
  for (const target of targets) {
    if (target.backend !== backend || isManagedServeRuntimeTarget(backend, target)) continue;
    const option = optionFromTarget(target);
    if (!option || seen.has(option.id)) continue;
    seen.add(option.id);
    options.push(option);
  }
  return options;
};

export const preferredRuntimeForBackend = (
  backend: Backend,
  targets: RuntimeTarget[],
): ServeRuntime => {
  const defaultWslTarget = targets.find(
    (target) => target.backend === backend && target.kind === "wsl2" && target.wslDefault,
  );
  const defaultWslRuntime = defaultWslTarget ? optionFromTarget(defaultWslTarget)?.runtime : null;
  return (
    defaultWslRuntime ??
    runtimeOptionsFor(backend, targets)[0]?.runtime ??
    defaultRuntimeForBackend(backend)
  );
};

export const runtimeOptionFor = (
  runtime: ServeRuntime,
  options: ServeRuntimeOption[],
): ServeRuntimeOption =>
  options.find((option) => option.id === runtimeId(runtime)) ?? {
    id: runtimeId(runtime),
    label: runtime.label ?? runtime.ref,
    detail: `${runtime.kind} · custom`,
    runtime,
    installed: true,
    canInstall: false,
    version: null,
  };
