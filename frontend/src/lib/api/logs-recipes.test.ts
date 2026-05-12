import { describe, expect, it, vi } from "vitest";
import type { Recipe } from "../types";
import type { ApiCore } from "./core";
import { createLogsApi } from "./logs";
import { createRecipesApi } from "./recipes";

function coreWithRequest() {
  return { request: vi.fn() } as unknown as ApiCore & { request: ReturnType<typeof vi.fn> };
}

describe("logs api module", () => {
  it("routes log requests through the injected core", async () => {
    const core = coreWithRequest();
    core.request.mockResolvedValueOnce({ sessions: [] }).mockResolvedValueOnce({ logs: [] });
    const api = createLogsApi(core);

    await expect(api.getLogSessions()).resolves.toEqual({ sessions: [] });
    await expect(api.getLogs("session-1", 50)).resolves.toEqual({ logs: [] });
    await api.deleteLogSession("session-1");

    expect(core.request).toHaveBeenNthCalledWith(1, "/logs");
    expect(core.request).toHaveBeenNthCalledWith(2, "/logs/session-1?limit=50");
    expect(core.request).toHaveBeenNthCalledWith(3, "/logs/session-1", { method: "DELETE" });
  });
});

describe("recipes api module", () => {
  it("normalizes list responses and writes mutations through the injected core", async () => {
    const core = coreWithRequest();
    const recipe = { id: "r1", name: "recipe" } as Recipe;
    core.request
      .mockResolvedValueOnce([{ id: "r1" }])
      .mockResolvedValueOnce({ id: "r1" })
      .mockResolvedValueOnce({ success: true, id: "r1" })
      .mockResolvedValueOnce({ success: true, id: "r1" });
    const api = createRecipesApi(core);

    await expect(api.getRecipes()).resolves.toEqual({ recipes: [{ id: "r1" }] });
    await expect(api.getRecipe("r1")).resolves.toEqual({ id: "r1" });
    await expect(api.createRecipe(recipe)).resolves.toEqual({ success: true, id: "r1" });
    await expect(api.updateRecipe("r1", recipe)).resolves.toEqual({ success: true, id: "r1" });
    await api.deleteRecipe("r1");

    expect(core.request).toHaveBeenNthCalledWith(1, "/recipes");
    expect(core.request).toHaveBeenNthCalledWith(2, "/recipes/r1");
    expect(core.request).toHaveBeenNthCalledWith(3, "/recipes", {
      method: "POST",
      body: JSON.stringify(recipe),
    });
    expect(core.request).toHaveBeenNthCalledWith(4, "/recipes/r1", {
      method: "PUT",
      body: JSON.stringify(recipe),
    });
    expect(core.request).toHaveBeenNthCalledWith(5, "/recipes/r1", { method: "DELETE" });
  });

  it("treats malformed recipe lists as empty", async () => {
    const core = coreWithRequest();
    core.request.mockResolvedValueOnce({ nope: true });

    await expect(createRecipesApi(core).getRecipes()).resolves.toEqual({ recipes: [] });
  });
});
