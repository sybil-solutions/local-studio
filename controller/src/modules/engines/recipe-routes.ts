import { Effect, Schema } from "effect";
import { CONTROLLER_EVENTS } from "@local-studio/contracts/controller-events";
import { badRequest, notFound } from "../../core/errors";
import { decodeJsonBody } from "../../core/validation";
import { effectHandler } from "../../http/effect-handler";
import { documentRoute, defineRoutes, mergeRoutes } from "../../http/route-registrar";
import { isRecipeRunning } from "../models/recipes/recipe-matching";
import { parseRecipe } from "../models/recipes/recipe-serializer";
import { Event } from "../system/event-manager";
import { createGetObservedProcess } from "./observed-process";

const RecipePayloadSchema = Schema.Record(Schema.String, Schema.Unknown);

export const registerRecipeRoutes = defineRoutes((app, context) => {
  const getObservedProcess = createGetObservedProcess(context);
  const publish = (event: Event): Effect.Effect<void> => context.eventManager.publish(event);

  return mergeRoutes(
    app.get(
      "/recipes",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const recipes = yield* context.stores.recipeStore.list();
          const current = yield* getObservedProcess("recipes.list");
          const launchingId = context.launchState.getLaunchingRecipeId();
          const result = recipes.map((recipe) => {
            const crashLoop = context.launchFailureBudget.get(recipe.id);
            let status = crashLoop?.blocked ? "error" : "stopped";
            if (launchingId === recipe.id) status = "starting";
            if (current && isRecipeRunning(recipe, current)) status = "running";
            return { ...recipe, status, crash_loop: crashLoop };
          });
          return ctx.json(result);
        }),
      ),
    ),

    app.get(
      "/recipes/:recipeId",
      documentRoute,
      effectHandler((ctx) =>
        context.stores.recipeStore
          .get(ctx.req.param("recipeId") ?? "")
          .pipe(
            Effect.flatMap((recipe) =>
              recipe ? Effect.succeed(ctx.json(recipe)) : Effect.fail(notFound("Recipe not found")),
            ),
          ),
      ),
    ),

    app.post(
      "/recipes",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const body = yield* decodeJsonBody(ctx, RecipePayloadSchema);
          const recipe = yield* Effect.try({
            try: () => parseRecipe(body),
            catch: (error) => badRequest(String(error)),
          });
          yield* context.stores.recipeStore
            .save(recipe)
            .pipe(Effect.mapError((error) => badRequest(error.message)));
          context.engineService.resetLaunchFailureBudget(recipe.id);
          yield* publish(new Event(CONTROLLER_EVENTS.RECIPE_CREATED, { recipe }));
          return ctx.json({ success: true, id: recipe.id });
        }),
      ),
    ),

    app.put(
      "/recipes/:recipeId",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const recipeId = ctx.req.param("recipeId") ?? "";
          const body = yield* decodeJsonBody(ctx, RecipePayloadSchema);
          const recipe = yield* Effect.try({
            try: () => parseRecipe({ ...body, id: recipeId }),
            catch: (error) => badRequest(String(error)),
          });
          yield* context.stores.recipeStore
            .save(recipe)
            .pipe(Effect.mapError((error) => badRequest(error.message)));
          context.engineService.resetLaunchFailureBudget(recipe.id);
          yield* publish(new Event(CONTROLLER_EVENTS.RECIPE_UPDATED, { recipe }));
          return ctx.json({ success: true, id: recipe.id });
        }),
      ),
    ),

    app.delete(
      "/recipes/:recipeId",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const recipeId = ctx.req.param("recipeId") ?? "";
          if (!(yield* context.stores.recipeStore.delete(recipeId))) {
            return yield* Effect.fail(notFound("Recipe not found"));
          }
          context.engineService.resetLaunchFailureBudget(recipeId);
          yield* context.eventManager.publish(
            new Event(CONTROLLER_EVENTS.RECIPE_DELETED, { recipe_id: recipeId }),
          );
          return ctx.json({ success: true });
        }),
      ),
    ),
  );
});
