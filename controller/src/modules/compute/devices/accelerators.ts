import { arch, platform } from "node:os";
import { Effect } from "effect";
import type { AcceleratorInfo, DeviceVendor, TelemetryField } from "../contracts";
import { detectGpuMonitoringTool, getGpuInfo } from "../../system/platform/gpu";
import type { GpuInfo, RuntimeGpuMonitoringTool } from "../../models/types";
import { neverFails, type DeviceProbe } from "./probe";

const MB = 1024 * 1024;

const TOOL_VENDORS: Readonly<Record<RuntimeGpuMonitoringTool, DeviceVendor>> = {
  "nvidia-smi": "nvidia",
  "amd-smi": "amd",
  "rocm-smi": "amd",
  "intel-sysfs": "intel",
  "apple-metal": "apple",
};

const ACCELERATOR_BY_VENDOR: Readonly<Record<DeviceVendor, AcceleratorInfo["accelerator"]>> = {
  nvidia: "cuda",
  amd: "rocm",
  intel: "xpu",
  apple: "metal",
  unknown: "cpu",
};

/** Stable across reboots. Indices renumber when a card is added or removed, so they are
 *  the last resort and are namespaced by vendor to stay unambiguous. */
const deviceIdFor = (gpu: GpuInfo, vendor: DeviceVendor): string =>
  gpu.uuid ?? gpu.pci_bus_id ?? `${vendor}:${gpu.index}`;

/**
 * `detectGpuMonitoringTool` only knows about the SMI binaries, so it answers null on
 * Apple Silicon even though `getGpuInfo` does return the SoC's GPU. Falling back to the
 * host is what keeps a Mac from being classified as a CPU-only box.
 */
const vendorFor = (tool: RuntimeGpuMonitoringTool | null): DeviceVendor => {
  if (tool) return TOOL_VENDORS[tool];
  if (platform() === "darwin" && arch() === "arm64") return "apple";
  return "unknown";
};

/**
 * The vendor probes already report, per GPU, which counters they could actually read
 * (`utilization_available`, `temperature_available`, …). Honouring those flags is what
 * lets the UI distinguish "this platform cannot tell you" from "it is currently zero" —
 * a 0 with the flag unset is the absence of a reading, not an idle GPU.
 *
 * The flags are optional in the contract; absent means "reported", which matches the
 * NVIDIA path where every counter is genuinely available.
 */
const available = (flag: boolean | undefined): boolean => flag !== false;

const reading = (flag: boolean | undefined, value: number | undefined): number | null =>
  available(flag) && typeof value === "number" && Number.isFinite(value) ? value : null;

const toAccelerator = (gpu: GpuInfo, vendor: DeviceVendor): AcceleratorInfo => ({
  id: deviceIdFor(gpu, vendor),
  index: gpu.index,
  vendor,
  name: gpu.name,
  accelerator: ACCELERATOR_BY_VENDOR[vendor],
  memoryTotalBytes: Math.max(0, gpu.memory_total_mb) * MB,
  memoryUsedBytes: available(gpu.memory_usage_available) ? Math.max(0, gpu.memory_used_mb) * MB : 0,
  // Apple Silicon and the Grace/GB10 parts share one pool with the CPU; never budget
  // their VRAM separately from host RAM.
  unifiedMemory: gpu.memory_shared === true,
  utilizationPct: reading(gpu.utilization_available, gpu.utilization_pct),
  temperatureC: reading(gpu.temperature_available, gpu.temp_c),
  powerWatts: reading(gpu.power_available, gpu.power_draw),
  powerLimitWatts: reading(gpu.power_available, gpu.power_limit),
  driver: null,
});

/** Which fields at least one accelerator on this host can actually answer. */
const capabilitiesOf = (accelerators: readonly AcceleratorInfo[]): readonly TelemetryField[] => {
  if (accelerators.length === 0) return [];
  const capabilities: TelemetryField[] = ["memory"];
  if (accelerators.some((entry) => entry.utilizationPct !== null)) capabilities.push("utilization");
  if (accelerators.some((entry) => entry.temperatureC !== null)) capabilities.push("temperature");
  if (accelerators.some((entry) => entry.powerWatts !== null)) capabilities.push("power");
  return capabilities;
};

/**
 * Every accelerator on this host, via whichever vendor tool is present. NVIDIA (incl. DGX
 * Spark), AMD, Intel and Apple Silicon all arrive through here — the vendor differences
 * live in the existing platform probes, and this only normalises their output.
 */
export const acceleratorProbe: DeviceProbe = {
  id: "accelerators",
  detect: () => true,
  run: () =>
    neverFails(
      Effect.gen(function* () {
        const tool = yield* detectGpuMonitoringTool();
        const gpus = yield* getGpuInfo();
        const vendor = vendorFor(tool);
        const accelerators = gpus.map((gpu) => toAccelerator(gpu, vendor));
        return { fragment: { accelerators }, capabilities: capabilitiesOf(accelerators) };
      }),
    ),
};
