import type { RouteRegistrar } from "../../http/route-registrar";
import { badRequest, notFound, serviceUnavailable } from "../../core/errors";
import { optionalString, parseJsonObjectBody } from "../../core/validation";
import { resolveBinary } from "../../core/command";
import { parseEnvironment } from "./environment-serializer";
import { seedEnvironmentsFromRecipes } from "./environment-seeder";
import {
  isEnvironmentRunning,
  listPulledImages,
  startEnvironment,
  stopEnvironment,
} from "./environment-process";
import { resolveImageForEnvironment } from "./image-registry";
import { isKnownEngineImage, listEngineImages, startEngineImagePull } from "./engine-images";
import type { Environment } from "./types";

const withStatus = (
  environment: Environment,
  pulledImages: Set<string>,
): Environment & { image: string; imagePulled: boolean; running: boolean } => {
  const image = resolveImageForEnvironment(environment);
  return {
    ...environment,
    image,
    imagePulled: pulledImages.has(image),
    running: isEnvironmentRunning(environment.id),
  };
};

export const registerEnvironmentRoutes: RouteRegistrar = (app, context) => {
  app.get("/environments", (ctx) => {
    seedEnvironmentsFromRecipes(context.stores.recipeStore, context.stores.environmentStore);
    const pulledImages = listPulledImages();
    const environments = context.stores.environmentStore
      .list()
      .map((environment) => withStatus(environment, pulledImages));
    return ctx.json(environments);
  });

  app.get("/environments/images", (ctx) => ctx.json(listEngineImages()));

  app.post("/environments/images/pull", async (ctx) => {
    const body = await parseJsonObjectBody(ctx);
    const image = optionalString(body, "image");
    if (!image) throw badRequest("image is required");
    if (!isKnownEngineImage(image)) {
      throw badRequest(`"${image}" is not a known engine image repository`);
    }
    if (!resolveBinary("docker")) throw serviceUnavailable("docker is not installed or not on PATH");
    return ctx.json(startEngineImagePull(image));
  });

  app.get("/environments/:environmentId", (ctx) => {
    const environment = context.stores.environmentStore.get(ctx.req.param("environmentId"));
    if (!environment) throw notFound("Environment not found");
    return ctx.json(withStatus(environment, listPulledImages()));
  });

  app.post("/environments", async (ctx) => {
    const body = await parseJsonObjectBody(ctx);
    const recipeId = optionalString(body, "recipeId");
    if (!recipeId) throw badRequest("recipeId is required");
    if (!context.stores.recipeStore.get(recipeId)) {
      throw badRequest(`No recipe found with id "${recipeId}"`);
    }
    let environment: Environment;
    try {
      environment = parseEnvironment(body);
    } catch (error) {
      throw badRequest(String(error));
    }
    context.stores.environmentStore.save(environment);
    return ctx.json(withStatus(environment, listPulledImages()));
  });

  app.delete("/environments/:environmentId", async (ctx) => {
    const environmentId = ctx.req.param("environmentId");
    const environment = context.stores.environmentStore.get(environmentId);
    if (!environment) throw notFound("Environment not found");
    if (isEnvironmentRunning(environmentId)) {
      await stopEnvironment(environmentId, true);
    }
    context.stores.environmentStore.delete(environmentId);
    return ctx.json({ success: true });
  });

  app.post("/environments/:environmentId/start", async (ctx) => {
    const environmentId = ctx.req.param("environmentId");
    const environment = context.stores.environmentStore.get(environmentId);
    if (!environment) throw notFound("Environment not found");
    const recipe = context.stores.recipeStore.get(environment.recipeId);
    if (!recipe) {
      throw badRequest(`Environment "${environmentId}" references a missing recipe`);
    }
    if (!resolveBinary("docker")) throw serviceUnavailable("docker is not installed or not on PATH");
    if (isEnvironmentRunning(environmentId)) {
      return ctx.json({ started: true, message: "Already running" });
    }
    const result = await startEnvironment(environment, recipe);
    return ctx.json(result, { status: result.started ? 200 : 502 });
  });

  app.post("/environments/:environmentId/stop", async (ctx) => {
    const environmentId = ctx.req.param("environmentId");
    if (!context.stores.environmentStore.get(environmentId)) throw notFound("Environment not found");
    const force = ctx.req.query("force") === "1";
    const stopped = await stopEnvironment(environmentId, force);
    return ctx.json({ stopped });
  });
};
