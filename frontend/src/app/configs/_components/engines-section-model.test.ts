import { describe, expect, it } from "vitest";
import type { RuntimeBackendInfo, RuntimeTarget, SystemRuntimeInfo } from "@/lib/types";
import { hasHydratedEngineRows, resolveEngineRowsView } from "./engines-section-model";

const backend = (overrides: Partial<RuntimeBackendInfo> = {}): RuntimeBackendInfo => ({
  installed: true,
  version: "0.1.0",
  upgrade_command_available: true,
  ...overrides,
});

const target = (overrides: Partial<RuntimeTarget> = {}): RuntimeTarget => ({
  id: "vllm-pip",
  backend: "vllm",
  label: "vLLM",
  kind: "venv",
  source: "discovered",
  installed: true,
  active: false,
  version: "0.1.0",
  pythonPath: null,
  binaryPath: null,
  dockerImage: null,
  capabilities: {
    canInspectOptions: true,
    canLaunch: true,
    canUpdate: true,
    supportsDocker: false,
  },
  health: { status: "ok" },
  ...overrides,
});

describe("engines section model", () => {
  it("prefers inference runtime targets over backend fallback rows", () => {
    const view = resolveEngineRowsView([target()], {
      vllm: backend(),
    } as SystemRuntimeInfo["backends"]);

    expect(view).toMatchObject({ kind: "targets" });
    expect(view.kind === "targets" ? view.targets.map((row) => row.id) : []).toEqual(["vllm-pip"]);
    expect(hasHydratedEngineRows(view)).toBe(true);
  });

  it("uses fallback backends after targets are absent", () => {
    const view = resolveEngineRowsView([], {
      vllm: backend(),
      llamacpp: backend({ installed: false }),
    } as SystemRuntimeInfo["backends"]);

    expect(view).toMatchObject({ kind: "backends" });
    expect(view.kind === "backends" ? view.rows.map((row) => row.id) : []).toEqual([
      "vllm",
      "llamacpp",
    ]);
    expect(hasHydratedEngineRows(view)).toBe(true);
  });

  it("returns pending rows before runtime data hydrates", () => {
    const view = resolveEngineRowsView([], undefined);

    expect(view).toMatchObject({ kind: "pending" });
    expect(hasHydratedEngineRows(view)).toBe(false);
  });
});
