import type { Ctx, DockerInspect } from "../context";

export type DockerStatus = "ok" | "unavailable" | "absent";

export type Inspect = DockerInspect & { RestartCount?: number };

export interface ImageInfo {
  Entrypoint: string[] | null;
  Id: string;
  RepoDigests: string[];
  Env: string[];
}

export const dockerStatus = async (ctx: Ctx): Promise<DockerStatus> => {
  if (!Bun.which("docker")) return "absent";
  const r = await ctx.exec(["docker", "info", "--format", "{{.ID}}"], { timeoutMs: 3000 });
  return r.code === 0 && r.stdout.trim() ? "ok" : "unavailable";
};

export const inspectContainers = async (ctx: Ctx, ids: string[]): Promise<Inspect[]> => {
  if (!ids.length) return [];
  const r = await ctx.exec(["docker", "inspect", ...ids], { timeoutMs: 8000 });
  if (r.code !== 0 && !r.stdout.trim().startsWith("[")) return [];
  try {
    return JSON.parse(r.stdout) as Inspect[];
  } catch {
    return [];
  }
};

export const runningContainers = async (ctx: Ctx): Promise<Inspect[]> => {
  const r = await ctx.exec(["docker", "ps", "-q", "--no-trunc"], { timeoutMs: 5000 });
  if (r.code !== 0) return [];
  const ids = r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  return (await inspectContainers(ctx, ids)).filter((c) => c.State?.Running);
};

const imageCache = new Map<string, ImageInfo | null>();

export const imageInfo = async (ctx: Ctx, image: string): Promise<ImageInfo | null> => {
  if (imageCache.has(image)) return imageCache.get(image) ?? null;
  const r = await ctx.exec(["docker", "image", "inspect", image], { timeoutMs: 8000 });
  let info: ImageInfo | null = null;
  if (r.code === 0) {
    try {
      const j = (JSON.parse(r.stdout) as { Id: string; RepoDigests?: string[]; Config?: { Env?: string[]; Entrypoint?: string[] | null } }[])[0];
      if (j) info = { Id: j.Id, RepoDigests: j.RepoDigests ?? [], Env: j.Config?.Env ?? [], Entrypoint: j.Config?.Entrypoint ?? null };
    } catch {}
  }
  if (info || !r.timedOut) imageCache.set(image, info);
  return info;
};

export const digestOf = (c: Inspect, img: ImageInfo | null): string | null => {
  const fromRef = (ref: string | undefined): string | null => (ref && ref.includes("@sha256:") ? (ref.split("@")[1] ?? null) : null);
  return fromRef(c.Config.Image) ?? fromRef(img?.RepoDigests[0]) ?? null;
};

export const containerName = (c: Inspect): string => c.Name.replace(/^\//, "");

export const publishedPorts = (c: Inspect): { hostPort: number; containerPort: number; hostIp: string }[] => {
  const out: { hostPort: number; containerPort: number; hostIp: string }[] = [];
  for (const [k, binds] of Object.entries(c.HostConfig.PortBindings ?? {})) {
    if (!k.endsWith("/tcp")) continue;
    for (const b of binds ?? []) {
      const hp = Number(b.HostPort);
      if (hp > 0 && !out.some((o) => o.hostPort === hp)) out.push({ hostPort: hp, containerPort: Number(k.split("/")[0]), hostIp: b.HostIp || "0.0.0.0" });
    }
  }
  return out;
};

export const wantsGpu = (c: Inspect): boolean =>
  (c.HostConfig.DeviceRequests ?? []).some((d) => d.Capabilities?.some((cap) => cap.includes("gpu")) || d.Driver === "nvidia");
