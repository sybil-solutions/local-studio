import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import type { GpuInfo } from "../../models/types";
import { resolveBinary, runCommand } from "../../../core/command";

type IntelPciGpu = {
  path: string;
  address: string;
  deviceId: string;
  classCode: string;
  driver: string | null;
};

const PCI_DEVICES_DIR = "/sys/bus/pci/devices";
const DRM_DIR = "/sys/class/drm";

const readText = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
};

const readNumber = (path: string): number | null => {
  const text = readText(path);
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

const readDeviceDriver = (devicePath: string): string | null => {
  try {
    return basename(realpathSync(join(devicePath, "driver")));
  } catch {
    return null;
  }
};

const isIntelComputeGpu = (gpu: IntelPciGpu): boolean => {
  if (gpu.driver === "xe") return true;
  if (gpu.deviceId.toLowerCase() === "0xe223") return true;
  return gpu.classCode.toLowerCase().startsWith("0x03");
};

const discoverIntelPciGpus = (): IntelPciGpu[] => {
  try {
    return readdirSync(PCI_DEVICES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isSymbolicLink() || entry.isDirectory())
      .map((entry) => {
        const path = join(PCI_DEVICES_DIR, entry.name);
        const vendor = readText(join(path, "vendor"))?.toLowerCase();
        if (vendor !== "0x8086") return null;

        const gpu: IntelPciGpu = {
          path,
          address: entry.name,
          deviceId: readText(join(path, "device")) ?? "",
          classCode: readText(join(path, "class")) ?? "",
          driver: readDeviceDriver(path),
        };
        return isIntelComputeGpu(gpu) ? gpu : null;
      })
      .filter((entry): entry is IntelPciGpu => Boolean(entry))
      .sort((a, b) => a.address.localeCompare(b.address));
  } catch {
    return [];
  }
};

const findDrmDevicePaths = (pciPath: string): string[] => {
  try {
    return readdirSync(DRM_DIR, { withFileTypes: true })
      .filter((entry) => entry.name.startsWith("card"))
      .map((entry) => {
        const devicePath = join(DRM_DIR, entry.name, "device");
        try {
          return realpathSync(devicePath) === realpathSync(pciPath)
            ? join(DRM_DIR, entry.name, "device")
            : null;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is string => Boolean(entry));
  } catch {
    return [];
  }
};

const readFirstNumber = (paths: string[]): number | null => {
  for (const path of paths) {
    const value = readNumber(path);
    if (value !== null) return value;
  }
  return null;
};

const findHwmonPaths = (pciPath: string): string[] => {
  try {
    return readdirSync(join(pciPath, "hwmon"), { withFileTypes: true })
      .filter((entry) => entry.name.startsWith("hwmon"))
      .map((entry) => join(pciPath, "hwmon", entry.name));
  } catch {
    return [];
  }
};

const readHwmonMetric = (hwmonPaths: string[], fileName: string): number | null =>
  readFirstNumber(hwmonPaths.map((path) => join(path, fileName)));

const readIntelName = (gpu: IntelPciGpu): string => {
  const lspci = resolveBinary("lspci");
  if (lspci) {
    const result = runCommand(lspci, ["-s", gpu.address.replace(/^0000:/, "")], 2_000);
    if (result.status === 0 && result.stdout) {
      const name = result.stdout.replace(/^[0-9a-f:.]+\s+/i, "").trim();
      if (name) return name;
    }
  }

  if (gpu.deviceId.toLowerCase() === "0xe223") {
    return "Intel Arc Pro B70";
  }
  return "Intel Arc GPU";
};

export const getGpuInfoFromIntelSysfs = (): GpuInfo[] =>
  discoverIntelPciGpus().map((gpu, index) => {
    const drmDevicePaths = findDrmDevicePaths(gpu.path);
    const memoryTotal =
      readFirstNumber(drmDevicePaths.map((path) => join(path, "mem_info_vram_total"))) ?? 0;
    const memoryUsed =
      readFirstNumber(drmDevicePaths.map((path) => join(path, "mem_info_vram_used"))) ?? 0;
    const memoryFree = Math.max(0, memoryTotal - memoryUsed);
    const hwmonPaths = findHwmonPaths(gpu.path);
    const temperature = Math.round((readHwmonMetric(hwmonPaths, "temp1_input") ?? 0) / 1000);
    const powerDraw = Number(
      ((readHwmonMetric(hwmonPaths, "power1_input") ?? 0) / 1_000_000).toFixed(1)
    );
    const powerLimit = Number(
      ((readHwmonMetric(hwmonPaths, "power1_cap") ?? 0) / 1_000_000).toFixed(1)
    );
    const toMb = (bytes: number): number => Math.max(0, Math.round(bytes / 1024 / 1024));

    return {
      index,
      name: readIntelName(gpu),
      memory_total: memoryTotal,
      memory_total_mb: toMb(memoryTotal),
      memory_used: memoryUsed,
      memory_used_mb: toMb(memoryUsed),
      memory_free: memoryFree,
      memory_free_mb: toMb(memoryFree),
      utilization: 0,
      utilization_pct: 0,
      temperature,
      temp_c: temperature,
      power_draw: powerDraw,
      power_limit: powerLimit,
    };
  });
