import type { ComputeEngineSpec, EngineSupport, HostProfile } from "../contracts";
import { health, noMetrics, plan, serverArguments, supported, unsupported, type Spelling } from "./shared";

const READY_DEADLINE_MS = 900_000;

/**
 * exllamav3 is a quantisation/inference library, not a server. The OpenAI-compatible
 * surface comes from TabbyAPI, which loads exl3 weights — so this spec launches the
 * TabbyAPI image and the "engine" is the loader it is configured with.
 *
 * TabbyAPI is configured mainly through config.yml; only the flags below are stable on
 * the command line, so most tuning arrives via extraArgs by design.
 */
const spelling: Spelling = {
  maxContextLength: { flag: "--max-seq-len" },
  // --gpu-split is a per-device VRAM list, not a rank count, so tensorParallel has no
  // equivalent; recipes that split across cards pass --gpu-split through extraArgs.
};

const image = (host: HostProfile): string | null =>
  host.accelerator === "cuda" ? "ghcr.io/theroyallab/tabbyapi:latest" : null;

const supports = (host: HostProfile): EngineSupport => {
  if (host.platform === "darwin") return unsupported("exllamav3 requires CUDA; macOS has none");
  if (host.accelerator !== "cuda") {
    return unsupported(`exllamav3 needs a CUDA device; this host reports ${host.accelerator}`);
  }
  return host.dockerGpu
    ? supported("docker")
    : unsupported("exllamav3 (TabbyAPI) needs Docker with GPU passthrough");
};

export const exllamav3: ComputeEngineSpec = {
  id: "exllamav3",
  defaultPort: 5000,
  health: health("/health", READY_DEADLINE_MS),
  metrics: noMetrics,
  image,
  supports,
  plan: (request) =>
    plan(request, {
      args: serverArguments(
        request,
        { modelFlag: "--model-dir", servedNameFlag: "--model-name", spelling },
        request.port,
      ),
      health: health("/health", READY_DEADLINE_MS),
      listenPort: request.port,
      image: image(request.host),
    }),
};
