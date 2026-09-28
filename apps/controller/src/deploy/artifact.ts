import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { exec } from "../core/exec";
import { DeployError, type Probe } from "./ssh";

export interface Artifact {
  version: string;
  pair: string;
  tarball: string;
  built: boolean;
}

const SOURCES = ["apps/controller/src", "apps/controller/package.json", "packages", "apps/ui/src", "apps/ui/index.html", "apps/ui/package.json", "scripts/release.sh"];
const SKIP = new Set(["node_modules", "dist", ".git"]);

export const repoRoot = (): string => {
  const candidates = [process.env.LOCAL_STUDIO_REPO, resolve(import.meta.dir, "../../../..")].filter((x): x is string => !!x);
  const root = candidates.find((d) => existsSync(join(d, "scripts/release.sh")) && existsSync(join(d, "apps/controller/package.json")));
  if (!root) throw new DeployError("cannot find the local-studio source tree (set LOCAL_STUDIO_REPO)");
  return root;
};

const newest = (path: string): number => {
  if (!existsSync(path)) return 0;
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  let max = st.mtimeMs;
  for (const name of readdirSync(path)) if (!SKIP.has(name)) max = Math.max(max, newest(join(path, name)));
  return max;
};

export const sourceVersion = (root: string): string =>
  (JSON.parse(readFileSync(join(root, "apps/controller/package.json"), "utf8")) as { version: string }).version;

export const artifactFor = async (target: Probe, log: (s: string) => void): Promise<Artifact> => {
  const root = repoRoot();
  const version = sourceVersion(root);
  const pair = `${target.os}-${target.arch}`;
  if (pair !== "linux-x64" && pair !== "linux-arm64" && pair !== "darwin-arm64") throw new DeployError(`no release target for ${pair}`);
  const tarball = join(root, "dist", `local-studio-${version}-${pair}.tar.gz`);
  const srcTime = Math.max(...SOURCES.map((s) => newest(join(root, s))));
  if (existsSync(tarball) && statSync(tarball).mtimeMs >= srcTime) return { version, pair, tarball, built: false };
  log(`building release ${version} (sources newer than artifact)`);
  const r = await exec(["bash", join(root, "scripts/release.sh")], { timeoutMs: 600_000, cwd: root });
  if (r.code !== 0) throw new DeployError(`scripts/release.sh failed: ${(r.stderr || r.stdout).trim().split("\n").slice(-6).join(" | ")}`);
  if (!existsSync(tarball)) throw new DeployError(`release did not produce ${tarball}`);
  return { version, pair, tarball, built: true };
};
