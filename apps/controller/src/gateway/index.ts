import type { Ctx, GatewayService, Module, Services } from "../context";
import { gatewayModels } from "./route-model";
import { gatewayRoutes } from "./routes";

export const createGateway = (ctx: Ctx, svc: Services): Module<GatewayService> => ({
  service: { models: () => gatewayModels(ctx, svc) },
  routes: gatewayRoutes(ctx, svc),
});
