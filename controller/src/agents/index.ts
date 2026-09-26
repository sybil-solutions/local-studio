import type { AgentService, Ctx, Module, Services } from "../context";
import { createDsh } from "./dsh";
import { createHarnessManager } from "./harnesses";
import { createAgentRoutes, createSessions } from "./routes";

export { runAgentCli } from "./cli";

const HARNESS_REFRESH_MS = 5 * 60_000;

export const createAgents = (ctx: Ctx, svc: Services): Module<AgentService> => {
  const dsh = createDsh(ctx);
  const harnesses = createHarnessManager(ctx);
  const sessions = createSessions(ctx, dsh);
  const refresh = () => {
    void harnesses.list().catch((e) => ctx.log.warn(`agents: harness probe failed: ${String(e)}`));
    void dsh.refresh().then(() => sessions.list()).catch(() => undefined);
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    service: { harnesses: () => harnesses.cached(), sessions: () => sessions.cached() },
    routes: createAgentRoutes(ctx, svc, { dsh, harnesses, sessions }),
    start() {
      refresh();
      timer = setInterval(refresh, HARNESS_REFRESH_MS);
    },
    stop() {
      clearInterval(timer);
      dsh.stop();
    },
  };
};
