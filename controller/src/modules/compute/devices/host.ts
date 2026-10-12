import { readFileSync } from "node:fs";
import { arch, cpus, freemem, platform, release, totalmem, uptime } from "node:os";
import { Effect } from "effect";
import type { HostArch, HostInfo, HostPlatform } from "../contracts";
import { realProcessRunner } from "../../../core/command";
import { neverFails, type DeviceProbe } from "./probe";

export const hostPlatform = (): HostPlatform => {
  const current = platform();
  if (current === "darwin" || current === "win32") return current;
  return "linux";
};

export const hostArch = (): HostArch => (arch() === "arm64" ? "arm64" : "x64");

/**
 * `os.freemem()` counts only wholly unused pages, so on Linux it understates what is
 * actually available by the size of the page cache. MemAvailable is the kernel's own
 * estimate and is the number a launch decision should use.
 */
const linuxMemoryField = (field: string): number | null => {
  try {
    const meminfo = readFileSync("/proc/meminfo", "utf8");
    const match = new RegExp(`^${field}:\\s+(\\d+)\\s+kB`, "m").exec(meminfo);
    const kilobytes = match?.[1];
    return kilobytes === undefined ? null : Number(kilobytes) * 1024;
  } catch {
    return null;
  }
};

/**
 * macOS reports almost everything as "inactive" rather than free, so `os.freemem()` on a
 * 34 GB Mac routinely answers a few hundred MB. Inactive and speculative pages are
 * reclaimable on demand, so the honest available figure is free + inactive + speculative,
 * minus whatever is pinned by compression.
 */
const darwinAvailableBytes = (): number | null => {
  const result = realProcessRunner.runSync("vm_stat", [], { timeoutMs: 2_000 });
  if (result.status !== 0 || result.stdout.length === 0) return null;
  const pageSize = Number(/page size of (\d+) bytes/.exec(result.stdout)?.[1] ?? 16384);
  const pages = (label: string): number =>
    Number(new RegExp(`${label}:\\s+(\\d+)`).exec(result.stdout)?.[1] ?? 0);
  const reclaimable =
    pages("Pages free") + pages("Pages inactive") + pages("Pages speculative") + pages("Pages purgeable");
  const bytes = reclaimable * pageSize;
  return Number.isFinite(bytes) && bytes > 0 ? bytes : null;
};

const availableMemoryBytes = (): number => {
  const platformName = hostPlatform();
  if (platformName === "linux") return linuxMemoryField("MemAvailable") ?? freemem();
  if (platformName === "darwin") return darwinAvailableBytes() ?? freemem();
  return freemem();
};

const swapTotalBytes = (): number | null =>
  hostPlatform() === "linux" ? linuxMemoryField("SwapTotal") : null;

export const readHostInfo = (): HostInfo => {
  const processors = cpus();
  return {
    cpuModel: processors[0]?.model.trim() ?? "unknown",
    cpuCount: processors.length,
    memoryTotalBytes: totalmem(),
    memoryAvailableBytes: availableMemoryBytes(),
    swapTotalBytes: swapTotalBytes(),
    platform: hostPlatform(),
    arch: hostArch(),
    release: release(),
    uptimeSeconds: Math.round(uptime()),
  };
};

export const hostProbe: DeviceProbe = {
  id: "host",
  detect: () => true,
  run: () =>
    neverFails(
      Effect.sync(() => ({
        fragment: { host: readHostInfo() },
        capabilities: ["hostMemory" as const],
      })),
    ),
};
