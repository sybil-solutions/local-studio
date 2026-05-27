import assert from "node:assert/strict";
import test from "node:test";

import {
  FALLBACK_ENGINES,
  hasHydratedEngineRows,
  resolveEngineRowsView,
} from "@/app/configs/_components/engines-section-model";
import type { RuntimeBackendInfo, RuntimeTarget, SystemRuntimeInfo } from "@/lib/types";

function backend(installed: boolean): RuntimeBackendInfo {
  return { installed, version: installed ? "1.0.0" : null };
}

function target(id: string, backendId: RuntimeTarget["backend"]): RuntimeTarget {
  return {
    id,
    backend: backendId,
    kind: backendId === "llamacpp" ? "binary" : "venv",
    label: id,
    installed: true,
    active: false,
    version: "1.0.0",
    source: "configured",
    capabilities: {
      canLaunch: true,
      canUpdate: false,
      canInspectOptions: true,
      supportsDocker: backendId !== "llamacpp",
    },
    health: { status: "ok" },
  };
}

test("settings engine rows prefer direct inference targets including llama.cpp", () => {
  const view = resolveEngineRowsView(
    [target("vllm-venv", "vllm"), target("llama-cpp-binary", "llamacpp"), target("mlx-venv", "mlx")],
    {
      vllm: backend(false),
      sglang: backend(false),
      llamacpp: backend(false),
    },
  );

  assert.equal(view.kind, "targets");
  assert.equal(hasHydratedEngineRows(view), true);
  assert.deepEqual(
    view.kind === "targets" ? view.targets.map((row) => [row.id, row.backend, row.kind]) : [],
    [
      ["vllm-venv", "vllm", "venv"],
      ["llama-cpp-binary", "llamacpp", "binary"],
      ["mlx-venv", "mlx", "venv"],
    ],
  );
});

test("settings engine rows fall back to backend summaries before runtime targets hydrate", () => {
  const backends: SystemRuntimeInfo["backends"] = {
    vllm: backend(true),
    sglang: backend(false),
    llamacpp: backend(true),
    mlx: backend(true),
    exllamav3: backend(false),
  };
  const view = resolveEngineRowsView([], backends);

  assert.equal(view.kind, "backends");
  assert.equal(hasHydratedEngineRows(view), true);
  assert.deepEqual(
    view.kind === "backends" ? view.rows.map((row) => [row.id, row.info.installed]) : [],
    [
      ["vllm", true],
      ["sglang", false],
      ["llamacpp", true],
      ["mlx", true],
      ["exllamav3", false],
    ],
  );
});

test("settings engine rows expose pending fallback engines before hydration", () => {
  const view = resolveEngineRowsView([], undefined);

  assert.deepEqual(view, { kind: "pending", engineIds: FALLBACK_ENGINES });
  assert.equal(hasHydratedEngineRows(view), false);
});
