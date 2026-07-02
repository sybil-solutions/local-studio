import { spawn } from "node:child_process";
import { resolveBinary, runCommand } from "../../core/command";
import { DEFAULT_ENGINE_IMAGE_SPECS, resolveEnvironmentImage } from "./image-registry";
import type { EnvironmentEngineId } from "./types";
import type {
  EngineImage,
  EngineImagePull,
  EngineImagesInfo,
} from "@local-studio/contracts/environments";

export type { EngineImage, EngineImagePull, EngineImagesInfo };

const ENGINE_IMAGE_REPOSITORIES: Record<EnvironmentEngineId, string> = {
  vllm: "vllm/vllm-openai",
  sglang: "lmsysorg/sglang",
  llamacpp: "ghcr.io/ggml-org/llama.cpp",
};

const ENGINE_IDS: EnvironmentEngineId[] = ["vllm", "sglang", "llamacpp"];

const pulls = new Map<string, EngineImagePull>();

export const listDockerImages = (): EngineImage[] => {
  const docker = resolveBinary("docker");
  if (!docker) return [];
  const result = runCommand(docker, [
    "images",
    "--format",
    "{{.Repository}}:{{.Tag}}\t{{.Tag}}\t{{.Size}}",
  ]);
  if (result.status !== 0) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [image = "", tag = "", size = ""] = line.split("\t");
      return { image, tag, size };
    });
};

const defaultImageFor = (engineId: EnvironmentEngineId): string => {
  const spec = DEFAULT_ENGINE_IMAGE_SPECS[engineId];
  return resolveEnvironmentImage({
    engineId,
    version: spec.version,
    ...(spec.variant ? { variant: spec.variant } : {}),
  });
};

export const listEngineImages = (): EngineImagesInfo[] => {
  const images = listDockerImages();
  return ENGINE_IDS.map((id) => {
    const repository = ENGINE_IMAGE_REPOSITORIES[id];
    return {
      id,
      repository,
      defaultImage: defaultImageFor(id),
      images: images.filter((entry) => entry.image.startsWith(`${repository}:`)),
      pulls: [...pulls.values()].filter((pull) => pull.image.startsWith(`${repository}:`)),
    };
  });
};

export const isKnownEngineImage = (image: string): boolean =>
  Object.values(ENGINE_IMAGE_REPOSITORIES).some((repository) => image.startsWith(`${repository}:`));

export const startEngineImagePull = (image: string): EngineImagePull => {
  const existing = pulls.get(image);
  if (existing && existing.status === "pulling") return existing;
  const docker = resolveBinary("docker");
  if (!docker) {
    const failed: EngineImagePull = {
      image,
      status: "failed",
      startedAt: new Date().toISOString(),
      error: "docker is not installed or not on PATH",
    };
    pulls.set(image, failed);
    return failed;
  }
  const pull: EngineImagePull = {
    image,
    status: "pulling",
    startedAt: new Date().toISOString(),
    error: null,
  };
  pulls.set(image, pull);
  const child = spawn(docker, ["pull", image], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-2000);
  });
  child.on("error", (error) => {
    pulls.set(image, { ...pull, status: "failed", error: String(error) });
  });
  child.on("exit", (code) => {
    pulls.set(
      image,
      code === 0
        ? { ...pull, status: "done" }
        : { ...pull, status: "failed", error: stderr.trim() || `docker pull exited with ${code}` },
    );
  });
  return pull;
};
