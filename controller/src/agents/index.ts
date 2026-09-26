import type { HarnessInfo } from "@local-studio/contracts";
import type { AgentService, Ctx, Module, Services } from "../context";
import { createDsh } from "./dsh";
import { createAgentRoutes, probeHarnesses } from "./routes";
import { createWorkspaceStore } from "./workspaces";

export { runAgentCli } from "./cli";

const HARNESS_REFRESH_MS = 5 * 60_000;

export const createAgents = (ctx: Ctx, svc: Services): Module<AgentService> => {
  const store = createWorkspaceStore(ctx.db);
  const dsh = createDsh(ctx);
  let harnesses: HarnessInfo[] = [];
  let pending: Promise<HarnessInfo[]> | null = null;
  const refreshHarnesses = (): Promise<HarnessInfo[]> =>
    (pending ??= probeHarnesses(ctx, dsh)
      .then((h) => (harnesses = h))
      .catch((e) => {
        ctx.log.warn(`agents: harness probe failed: ${String(e)}`);
        return harnesses;
      })
      .finally(() => {
        pending = null;
      }));
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    service: {
      harnesses: () => harnesses,
      workspaces: () => store.list(),
      dsh: () => dsh.status(),
    },
    routes: createAgentRoutes(ctx, svc, { store, dsh, harnesses: () => harnesses, refreshHarnesses }),
    start() {
      void refreshHarnesses();
      void dsh.refresh();
      timer = setInterval(() => void refreshHarnesses(), HARNESS_REFRESH_MS);
    },
    stop() {
      clearInterval(timer);
      dsh.stop();
    },
  };
};
