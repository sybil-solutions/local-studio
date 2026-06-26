import { describe, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  createTestApp,
  readControllerFunctionCallRows,
  readControllerRequestRows,
  registerControllerTestLifecycle,
  tempDir,
} from "./fixtures";

registerControllerTestLifecycle();

describe("controller route contracts", () => {
  test("recipe CRUD routes persist success and not-found observability", async () => {
    const app = await createTestApp();
    const recipePayload = {
      id: "route-test-recipe",
      name: "Route Test Recipe",
      model_path: join(tempDir, "models", "route-test-model"),
      backend: "vllm",
      served_model_name: "route-test-model",
      tensor_parallel_size: 2,
      max_model_len: 8192,
      gpu_memory_utilization: 0.75,
      unknown_runtime_flag: "--example",
    };

    const createResponse = await app.request("/recipes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(recipePayload),
    });
    const createBody = await createResponse.json();
    expect(createResponse.status).toBe(200);
    expect(createBody).toEqual({ success: true, id: "route-test-recipe" });

    const listResponse = await app.request("/recipes");
    const listBody = await listResponse.json();
    expect(listResponse.status).toBe(200);
    expect(listBody).toEqual([
      expect.objectContaining({
        id: "route-test-recipe",
        name: "Route Test Recipe",
        backend: "vllm",
        served_model_name: "route-test-model",
        tensor_parallel_size: 2,
        max_model_len: 8192,
        status: "stopped",
        extra_args: { unknown_runtime_flag: "--example" },
      }),
    ]);

    const getResponse = await app.request("/recipes/route-test-recipe");
    const getBody = await getResponse.json();
    expect(getResponse.status).toBe(200);
    expect(getBody).toMatchObject({
      id: "route-test-recipe",
      name: "Route Test Recipe",
      gpu_memory_utilization: 0.75,
    });

    const updateResponse = await app.request("/recipes/route-test-recipe", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...recipePayload,
        name: "Updated Route Test Recipe",
        max_num_seqs: 16,
      }),
    });
    const updateBody = await updateResponse.json();
    expect(updateResponse.status).toBe(200);
    expect(updateBody).toEqual({ success: true, id: "route-test-recipe" });

    const updatedResponse = await app.request("/recipes/route-test-recipe");
    const updatedBody = await updatedResponse.json();
    expect(updatedResponse.status).toBe(200);
    expect(updatedBody).toMatchObject({
      id: "route-test-recipe",
      name: "Updated Route Test Recipe",
      max_num_seqs: 16,
    });

    const deleteResponse = await app.request("/recipes/route-test-recipe", {
      method: "DELETE",
    });
    const deleteBody = await deleteResponse.json();
    expect(deleteResponse.status).toBe(200);
    expect(deleteBody).toEqual({ success: true });

    const missingResponse = await app.request("/recipes/route-test-recipe");
    const missingBody = await missingResponse.json();
    expect(missingResponse.status).toBe(404);
    expect(missingBody).toEqual({ detail: "Recipe not found" });

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          path: "/recipes",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/recipes",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/recipes/route-test-recipe",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "PUT",
          path: "/recipes/route-test-recipe",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "DELETE",
          path: "/recipes/route-test-recipe",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/recipes/route-test-recipe",
          status: 404,
          success: 0,
        }),
      ]),
    );

    expect(readControllerFunctionCallRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function_name: "recipes.list.getCurrentProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
      ]),
    );
  });

  test("engine lifecycle control routes expose no-op and missing-resource contracts", async () => {
    const app = await createTestApp();

    const missingLaunchResponse = await app.request("/launch/missing-recipe", {
      method: "POST",
    });
    const missingLaunchBody = await missingLaunchResponse.json();
    expect(missingLaunchResponse.status).toBe(404);
    expect(missingLaunchBody).toEqual({ detail: "Recipe not found" });

    const missingCancelResponse = await app.request(
      "/launch/missing-recipe/cancel",
      {
        method: "POST",
      },
    );
    const missingCancelBody = await missingCancelResponse.json();
    expect(missingCancelResponse.status).toBe(404);
    expect(missingCancelBody).toEqual({
      detail: "No launch in progress for missing-recipe",
    });

    const evictResponse = await app.request("/evict", { method: "POST" });
    const evictBody = await evictResponse.json();
    expect(evictResponse.status).toBe(200);
    expect(evictBody).toEqual({ success: true, evicted_pid: null });

    const waitReadyResponse = await app.request("/wait-ready?timeout=0");
    const waitReadyBody = await waitReadyResponse.json();
    expect(waitReadyResponse.status).toBe(200);
    expect(waitReadyBody).toEqual({
      ready: false,
      elapsed: 0,
      error: "Timeout waiting for backend",
    });

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          path: "/launch/missing-recipe",
          status: 404,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/launch/missing-recipe/cancel",
          status: 404,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/evict",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/wait-ready",
          status: 200,
          success: 1,
        }),
      ]),
    );
  });

  test("recipe launch failures trip per-recipe crash-loop budget and reset on edit", async () => {
    const app = await createTestApp();
    const recipePayload = {
      id: "crash-loop-recipe",
      name: "Crash Loop Recipe",
      model_path: join(tempDir, "models", "crash-loop-model.gguf"),
      backend: "llamacpp",
      llama_bin: "not-llama-server",
    };

    const createResponse = await app.request("/recipes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(recipePayload),
    });
    expect(createResponse.status).toBe(200);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await app.request("/launch/crash-loop-recipe", {
        method: "POST",
      });
      const body = await response.json();
      expect(response.status).toBe(503);
      expect(body.detail).toContain("Invalid llama_bin");
      expect(body.detail).not.toContain("budget exhausted");
    }

    const blockedRecipesResponse = await app.request("/recipes");
    const blockedRecipes = await blockedRecipesResponse.json();
    const blockedRecipe = blockedRecipes.find(
      (recipe: { id: string }) => recipe.id === "crash-loop-recipe",
    );
    expect(blockedRecipe).toMatchObject({
      id: "crash-loop-recipe",
      status: "error",
      crash_loop: {
        recipe_id: "crash-loop-recipe",
        failure_count: 3,
        limit: 3,
        blocked: true,
      },
    });
    expect(blockedRecipe.crash_loop.reset_at).toEqual(expect.any(String));

    const statusResponse = await app.request("/status");
    const statusBody = await statusResponse.json();
    expect(statusBody.launch_failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recipe_id: "crash-loop-recipe",
          failure_count: 3,
          limit: 3,
          blocked: true,
        }),
      ]),
    );

    const rejectedResponse = await app.request("/launch/crash-loop-recipe", {
      method: "POST",
    });
    const rejectedBody = await rejectedResponse.json();
    expect(rejectedResponse.status).toBe(503);
    expect(rejectedBody.detail).toContain("Launch crash-loop budget exhausted");
    expect(rejectedBody.detail).toContain("3/3 failed attempts");

    const updateResponse = await app.request("/recipes/crash-loop-recipe", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...recipePayload, name: "Edited Crash Loop Recipe" }),
    });
    expect(updateResponse.status).toBe(200);

    const resetRecipesResponse = await app.request("/recipes");
    const resetRecipes = await resetRecipesResponse.json();
    const resetRecipe = resetRecipes.find(
      (recipe: { id: string }) => recipe.id === "crash-loop-recipe",
    );
    expect(resetRecipe).toMatchObject({
      id: "crash-loop-recipe",
      status: "stopped",
      crash_loop: null,
    });

    const postResetResponse = await app.request("/launch/crash-loop-recipe", {
      method: "POST",
    });
    const postResetBody = await postResetResponse.json();
    expect(postResetResponse.status).toBe(503);
    expect(postResetBody.detail).toContain("Invalid llama_bin");
    expect(postResetBody.detail).not.toContain("budget exhausted");
  });

  test("runtime and download validation routes persist observable outcomes", async () => {
    const app = await createTestApp();

    const downloadsResponse = await app.request("/studio/downloads");
    const downloadsBody = await downloadsResponse.json();
    expect(downloadsResponse.status).toBe(200);
    expect(downloadsBody).toEqual({ downloads: [] });

    const missingDownloadResponse = await app.request(
      "/studio/downloads/missing-download",
    );
    const missingDownloadBody = await missingDownloadResponse.json();
    expect(missingDownloadResponse.status).toBe(404);
    expect(missingDownloadBody).toEqual({ detail: "Download not found" });

    const invalidDownloadResponse = await app.request("/studio/downloads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: "main" }),
    });
    const invalidDownloadBody = await invalidDownloadResponse.json();
    expect(invalidDownloadResponse.status).toBe(400);
    expect(invalidDownloadBody).toEqual({ detail: "model_id is required" });

    for (const action of ["pause", "resume", "cancel"]) {
      const response = await app.request(
        `/studio/downloads/missing-download/${action}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const body = await response.json();
      expect(response.status).toBe(404);
      expect(body).toEqual({ detail: "Download not found" });
    }

    const runtimeTargetsResponse = await app.request("/runtime/targets");
    const runtimeTargetsBody = await runtimeTargetsResponse.json();
    expect(runtimeTargetsResponse.status).toBe(200);
    expect(Array.isArray(runtimeTargetsBody.targets)).toBe(true);

    const missingTargetResponse = await app.request(
      "/runtime/targets/missing-target",
    );
    const missingTargetBody = await missingTargetResponse.json();
    expect(missingTargetResponse.status).toBe(404);
    expect(missingTargetBody).toEqual({ detail: "Runtime target not found" });

    const invalidRuntimeJobResponse = await app.request("/runtime/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "update" }),
    });
    const invalidRuntimeJobBody = await invalidRuntimeJobResponse.json();
    expect(invalidRuntimeJobResponse.status).toBe(400);
    expect(invalidRuntimeJobBody).toEqual({ detail: "backend is required" });

    const invalidRuntimeBackendResponse = await app.request("/runtime/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ backend: "unknown", type: "update" }),
    });
    const invalidRuntimeBackendBody =
      await invalidRuntimeBackendResponse.json();
    expect(invalidRuntimeBackendResponse.status).toBe(400);
    expect(invalidRuntimeBackendBody).toEqual({ detail: "Invalid backend" });

    const invalidRuntimeJobTypeResponse = await app.request("/runtime/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ backend: "vllm", type: "restart" }),
    });
    const invalidRuntimeJobTypeBody =
      await invalidRuntimeJobTypeResponse.json();
    expect(invalidRuntimeJobTypeResponse.status).toBe(400);
    expect(invalidRuntimeJobTypeBody).toEqual({ detail: "Invalid job type" });

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          path: "/studio/downloads",
          status: 200,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/studio/downloads/missing-download",
          status: 404,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/studio/downloads",
          status: 400,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/studio/downloads/missing-download/pause",
          status: 404,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/studio/downloads/missing-download/resume",
          status: 404,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/studio/downloads/missing-download/cancel",
          status: 404,
          success: 0,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/runtime/targets",
          status: 200,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/runtime/targets/missing-target",
          status: 404,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/runtime/jobs",
          status: 400,
          success: 0,
        }),
      ]),
    );

    expect(readControllerFunctionCallRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function_name: "runtime.targets.getCurrentProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "runtime.target.getCurrentProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
      ]),
    );
  });

  test("runtime target selection and health routes persist observable outcomes", async () => {
    const llamaBin = join(tempDir, "llama-server-test");
    writeFileSync(
      llamaBin,
      [
        "#!/usr/bin/env sh",
        'if [ "$1" = "--version" ]; then echo \'llama-server test runtime\'; exit 0; fi',
        'if [ "$1" = "--help" ]; then echo \'usage: llama-server-test\'; exit 0; fi',
        "exit 0",
        "",
      ].join("\n"),
      "utf8",
    );
    chmodSync(llamaBin, 0o755);
    process.env.LOCAL_STUDIO_LLAMA_BIN = llamaBin;
    const sglangPython = join(tempDir, "python-sglang-test");
    writeFileSync(
      sglangPython,
      [
        "#!/usr/bin/env sh",
        'if [ "$1" = "--version" ] || [ "$1" = "-V" ]; then echo \'Python 3.12.0\'; exit 0; fi',
        'if [ "$1" = "-c" ]; then echo \'{"version":"0.4.0","python":"\'"$0"\'"}\'; exit 0; fi',
        "exit 0",
        "",
      ].join("\n"),
      "utf8",
    );
    chmodSync(sglangPython, 0o755);
    process.env.LOCAL_STUDIO_SGLANG_PYTHON = sglangPython;
    const mlxPython = join(tempDir, "python-mlx-test");
    writeFileSync(
      mlxPython,
      [
        "#!/usr/bin/env sh",
        'if [ "$1" = "--version" ]; then echo \'Python 3.12.0\'; exit 0; fi',
        'if [ "$1" = "-c" ]; then echo \'{"version":"0.24.0","python":"\'"$0"\'"}\'; exit 0; fi',
        "exit 0",
        "",
      ].join("\n"),
      "utf8",
    );
    chmodSync(mlxPython, 0o755);
    process.env.LOCAL_STUDIO_MLX_PYTHON = mlxPython;
    const app = await createTestApp();

    const targetsResponse = await app.request("/runtime/targets");
    const targetsBody = await targetsResponse.json();
    expect(targetsResponse.status).toBe(200);
    const target = targetsBody.targets.find(
      (candidate: Record<string, unknown>) =>
        candidate["backend"] === "llamacpp" &&
        candidate["source"] === "configured" &&
        candidate["binaryPath"] === llamaBin,
    );
    expect(target).toMatchObject({
      backend: "llamacpp",
      kind: "binary",
      source: "configured",
      installed: true,
      active: false,
      binaryPath: llamaBin,
      capabilities: expect.objectContaining({
        canLaunch: true,
        canInspectOptions: true,
      }),
      health: { status: "ok" },
    });
    if (!target)
      throw new Error("Expected configured llama.cpp runtime target");

    const sglangTarget = targetsBody.targets.find(
      (candidate: Record<string, unknown>) =>
        candidate["backend"] === "sglang" &&
        candidate["source"] === "configured" &&
        candidate["pythonPath"] === sglangPython,
    );
    expect(sglangTarget).toMatchObject({
      backend: "sglang",
      kind: "venv",
      source: "configured",
      installed: true,
      active: false,
      version: "0.4.0",
      pythonPath: sglangPython,
      capabilities: expect.objectContaining({
        canLaunch: true,
        canUpdate: true,
        canInspectOptions: false,
      }),
      update: expect.objectContaining({
        targetVersion: "latest",
        packageSpec: "sglang",
      }),
      health: { status: "ok" },
    });
    if (!sglangTarget)
      throw new Error("Expected configured SGLang runtime target");

    const mlxTarget = targetsBody.targets.find(
      (candidate: Record<string, unknown>) =>
        candidate["backend"] === "mlx" &&
        candidate["source"] === "configured" &&
        candidate["pythonPath"] === mlxPython,
    );
    expect(mlxTarget).toMatchObject({
      backend: "mlx",
      kind: "venv",
      source: "configured",
      installed: true,
      active: false,
      version: "0.24.0",
      pythonPath: mlxPython,
      capabilities: expect.objectContaining({
        canLaunch: true,
        canUpdate: false,
        canInspectOptions: false,
      }),
      health: { status: "ok" },
    });
    if (!mlxTarget) throw new Error("Expected configured MLX runtime target");

    const targetId = String(target.id);
    const targetResponse = await app.request(`/runtime/targets/${targetId}`);
    const targetBody = await targetResponse.json();
    expect(targetResponse.status).toBe(200);
    expect(targetBody.target).toMatchObject({
      id: targetId,
      backend: "llamacpp",
      binaryPath: llamaBin,
      health: { status: "ok" },
    });

    const healthResponse = await app.request(
      `/runtime/targets/${targetId}/health`,
    );
    const healthBody = await healthResponse.json();
    expect(healthResponse.status).toBe(200);
    expect(healthBody).toEqual({ health: { status: "ok" } });

    const selectResponse = await app.request(
      `/runtime/targets/${targetId}/select`,
      {
        method: "POST",
      },
    );
    const selectBody = await selectResponse.json();
    expect(selectResponse.status).toBe(200);
    expect(selectBody.target).toMatchObject({
      id: targetId,
      active: true,
      backend: "llamacpp",
    });

    const refreshedResponse = await app.request("/runtime/targets");
    const refreshedBody = await refreshedResponse.json();
    expect(refreshedResponse.status).toBe(200);
    expect(
      refreshedBody.targets.find(
        (candidate: Record<string, unknown>) => candidate["id"] === targetId,
      ),
    ).toMatchObject({ active: true });

    const mlxResponse = await app.request("/runtime/mlx");
    const mlxBody = await mlxResponse.json();
    expect(mlxResponse.status).toBe(200);
    expect(mlxBody).toMatchObject({
      installed: true,
      version: "0.24.0",
      python_path: mlxPython,
      upgrade_command_available: false,
    });

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          path: "/runtime/targets",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: `/runtime/targets/${targetId}`,
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: `/runtime/targets/${targetId}/health`,
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "POST",
          path: `/runtime/targets/${targetId}/select`,
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/runtime/mlx",
          status: 200,
          success: 1,
        }),
      ]),
    );

    expect(readControllerFunctionCallRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function_name: "runtime.targets.getCurrentProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "runtime.target.getCurrentProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "runtime.target.health.getCurrentProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "runtime.target.select.getCurrentProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
      ]),
    );
  });

  test("runtime job lookup and config routes expose safe contracts without starting jobs", async () => {
    const app = await createTestApp();

    const jobsResponse = await app.request("/runtime/jobs");
    const jobsBody = await jobsResponse.json();
    expect(jobsResponse.status).toBe(200);
    expect(jobsBody).toEqual({ jobs: [] });

    const missingJobResponse = await app.request("/runtime/jobs/missing-job");
    const missingJobBody = await missingJobResponse.json();
    expect(missingJobResponse.status).toBe(404);
    expect(missingJobBody).toEqual({ detail: "Runtime job not found" });

    const missingCancelResponse = await app.request(
      "/runtime/jobs/missing-job/cancel",
      {
        method: "POST",
      },
    );
    const missingCancelBody = await missingCancelResponse.json();
    expect(missingCancelResponse.status).toBe(404);
    expect(missingCancelBody).toEqual({ detail: "Runtime job not found" });

    const mlxJobResponse = await app.request("/runtime/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ backend: "mlx", type: "update" }),
    });
    const mlxJobBody = await mlxJobResponse.json();
    expect(mlxJobResponse.status).toBe(200);
    expect(mlxJobBody.job).toMatchObject({
      backend: "mlx",
      type: "update",
    });

    const invalidArgsResponse = await app.request("/runtime/vllm/upgrade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ args: ["--dry-run", 42] }),
    });
    const invalidArgsBody = await invalidArgsResponse.json();
    expect(invalidArgsResponse.status).toBe(400);
    expect(invalidArgsBody).toEqual({
      detail: "Request-controlled command or args are not allowed for runtime jobs",
    });

    for (const route of [
      "/runtime/sglang/upgrade",
      "/runtime/llamacpp/upgrade",
      "/runtime/cuda/upgrade",
      "/runtime/rocm/upgrade",
    ]) {
      const response = await app.request(route, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ args: ["--dry-run", 42] }),
      });
      const body = await response.json();
      expect(response.status).toBe(400);
      expect(body).toEqual({
        detail: "Request-controlled command or args are not allowed for runtime jobs",
      });
    }

    const vllmConfigResponse = await app.request("/runtime/vllm/config");
    const vllmConfigBody = await vllmConfigResponse.json();
    expect(vllmConfigResponse.status).toBe(200);
    expect(vllmConfigBody).toEqual(expect.any(Object));

    const llamaConfigResponse = await app.request("/runtime/llamacpp/config");
    const llamaConfigBody = await llamaConfigResponse.json();
    expect(llamaConfigResponse.status).toBe(200);
    expect(llamaConfigBody).toEqual(expect.any(Object));

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          path: "/runtime/jobs",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/runtime/jobs/missing-job",
          status: 404,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/runtime/jobs/missing-job/cancel",
          status: 404,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/runtime/jobs",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/runtime/vllm/upgrade",
          status: 400,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/runtime/sglang/upgrade",
          status: 400,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/runtime/llamacpp/upgrade",
          status: 400,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/runtime/cuda/upgrade",
          status: 400,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/runtime/rocm/upgrade",
          status: 400,
          success: 0,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/runtime/vllm/config",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/runtime/llamacpp/config",
          status: 200,
          success: 1,
        }),
      ]),
    );

    expect(readControllerFunctionCallRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function_name: "runtime.jobs.getCurrentProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
      ]),
    );
  }, 30_000);

  test("managed runtime install helpers stay inside controller data dir", async () => {
    const { managedPackageSpec, managedVenvPath } =
      await import("../../../controller/src/modules/engines/runtimes/engine-jobs");
    const { getSglangRuntimePython } =
      await import("../../../controller/src/modules/engines/runtimes/runtime-upgrade");
    const selectedSglangPython = join(
      tempDir,
      "runtime",
      "venvs",
      "sglang-latest",
      "bin",
      "python",
    );

    expect(managedVenvPath({ data_dir: tempDir }, "vllm")).toBe(
      join(tempDir, "runtime", "venvs", "vllm-latest"),
    );
    expect(managedPackageSpec("vllm")).toBe("vllm");
    expect(managedPackageSpec("vllm", "0.10.2")).toBe("vllm==0.10.2");
    expect(managedPackageSpec("sglang")).toBe("sglang[all]");
    expect(managedPackageSpec("mlx")).toBe("mlx-lm");
    expect(
      getSglangRuntimePython(
        { sglang_python: join(tempDir, "fallback-python") } as Parameters<
          typeof getSglangRuntimePython
        >[0],
        { pythonPath: selectedSglangPython },
      ),
    ).toBe(selectedSglangPython);
  });

  test("runtime backend metadata routes expose host-shaped contracts and observability", async () => {
    const app = await createTestApp();

    const vllmResponse = await app.request("/runtime/vllm");
    const vllmBody = await vllmResponse.json();
    expect(vllmResponse.status).toBe(200);
    expect(vllmBody).toMatchObject({
      installed: expect.any(Boolean),
      upgrade_command_available: expect.any(Boolean),
    });
    expect(
      vllmBody.version === null || typeof vllmBody.version === "string",
    ).toBe(true);
    expect(
      vllmBody.python_path === null || typeof vllmBody.python_path === "string",
    ).toBe(true);
    expect(
      vllmBody.vllm_bin === null || typeof vllmBody.vllm_bin === "string",
    ).toBe(true);

    const sglangResponse = await app.request("/runtime/sglang");
    const sglangBody = await sglangResponse.json();
    expect(sglangResponse.status).toBe(200);
    expect(sglangBody).toMatchObject({
      installed: expect.any(Boolean),
      upgrade_command_available: expect.any(Boolean),
    });
    expect(
      sglangBody.version === null || typeof sglangBody.version === "string",
    ).toBe(true);
    expect(
      sglangBody.python_path === null ||
        typeof sglangBody.python_path === "string",
    ).toBe(true);

    const llamaResponse = await app.request("/runtime/llamacpp");
    const llamaBody = await llamaResponse.json();
    expect(llamaResponse.status).toBe(200);
    expect(llamaBody).toMatchObject({
      installed: expect.any(Boolean),
      upgrade_command_available: expect.any(Boolean),
    });
    expect(
      llamaBody.version === null || typeof llamaBody.version === "string",
    ).toBe(true);
    expect(
      llamaBody.binary_path === null ||
        typeof llamaBody.binary_path === "string",
    ).toBe(true);

    const mlxResponse = await app.request("/runtime/mlx");
    const mlxBody = await mlxResponse.json();
    expect(mlxResponse.status).toBe(200);
    expect(mlxBody).toMatchObject({
      installed: expect.any(Boolean),
      upgrade_command_available: expect.any(Boolean),
    });
    expect(
      mlxBody.version === null || typeof mlxBody.version === "string",
    ).toBe(true);
    expect(
      mlxBody.python_path === null || typeof mlxBody.python_path === "string",
    ).toBe(true);

    const cudaResponse = await app.request("/runtime/cuda");
    const cudaBody = await cudaResponse.json();
    expect(cudaResponse.status).toBe(200);
    expect(cudaBody).toMatchObject({
      upgrade_command_available: expect.any(Boolean),
    });
    expect(
      cudaBody.driver_version === null ||
        typeof cudaBody.driver_version === "string",
    ).toBe(true);
    expect(
      cudaBody.cuda_version === null ||
        typeof cudaBody.cuda_version === "string",
    ).toBe(true);

    const rocmResponse = await app.request("/runtime/rocm");
    const rocmBody = await rocmResponse.json();
    expect(rocmResponse.status).toBe(200);
    expect(rocmBody).toMatchObject({
      gpu_arch: expect.any(Array),
      upgrade_command_available: expect.any(Boolean),
    });
    expect(
      rocmBody.rocm_version === null ||
        typeof rocmBody.rocm_version === "string",
    ).toBe(true);
    expect(
      rocmBody.hip_version === null || typeof rocmBody.hip_version === "string",
    ).toBe(true);
    expect(
      rocmBody.smi_tool === null || typeof rocmBody.smi_tool === "string",
    ).toBe(true);

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          path: "/runtime/vllm",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/runtime/sglang",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/runtime/llamacpp",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/runtime/mlx",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/runtime/cuda",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/runtime/rocm",
          status: 200,
          success: 1,
        }),
      ]),
    );

    expect(readControllerFunctionCallRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function_name: "runtime.backend.sglang.getCurrentProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "runtime.backend.llamacpp.getCurrentProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "runtime.backend.mlx.getCurrentProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
      ]),
    );
  }, 20_000);
});
