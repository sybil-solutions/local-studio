import type { Backend, RuntimeTarget, ServeRuntime, ServeRuntimeKind } from "@/lib/types";
import {
  defaultRuntimeForBackend,
  isManagedServeRuntimeTarget,
  runtimeId,
} from "@/features/recipes/serve-runtime";
import { ENGINE_LABEL } from "./engine-capabilities";

export { defaultRuntimeForBackend, runtimeId } from "@/features/recipes/serve-runtime";

export interface ServeRuntimeOption {
  id: string;
  label: string;
  detail: string;
  runtime: ServeRuntime;
  installed: boolean;
  canInstall: boolean;
  version: string | null;
}

const targetReference = (target: RuntimeTarget): string | null => {
  if (target.kind === "docker") return target.dockerImage ?? null;
  if (target.kind === "binary") return target.binaryPath ?? null;
  return target.binaryPath ?? target.pythonPath ?? null;
};

const runtimeKindForTarget = (target: RuntimeTarget): ServeRuntimeKind => {
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
    label: target.label,
  } satisfies ServeRuntime;
  return {
    id: runtimeId(runtime),
    label: target.label,
    detail: [target.kind, target.source, target.version].filter(Boolean).join(" · "),
    runtime,
    installed: target.installed,
    canInstall: false,
    version: target.version,
  };
};

export const runtimeOptionsFor = (
  backend: Backend,
  targets: RuntimeTarget[],
): ServeRuntimeOption[] => {
  const defaultRuntime = defaultRuntimeForBackend(backend);
  const managed = targets.find((target) => isManagedServeRuntimeTarget(backend, target));
  const options: ServeRuntimeOption[] = [
    {
      id: runtimeId(defaultRuntime),
      label: defaultRuntime.label ?? `${ENGINE_LABEL[backend]} (Docker)`,
      detail: managed?.version ? `pinned image · ${managed.version}` : "engine's pinned image",
      runtime: defaultRuntime,
      installed: Boolean(managed?.installed),
      canInstall: !managed?.installed,
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
