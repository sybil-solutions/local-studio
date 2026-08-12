import { describe, expect, test } from "bun:test";
import { parseNvidiaSmiDriverVersion, parseNvidiaSmiGpuOutput } from "./gpu";

describe("NVIDIA SMI output", () => {
  test("parses multiple Windows NVIDIA devices and driver version", () => {
    const output = [
      "GPU-a, 00000000:01:00.0, NVIDIA GeForce RTX 3090, 24576, 1024, 23552, 18, 42, 90.5, 350.0, 610.62",
      "GPU-b, 00000000:02:00.0, NVIDIA GeForce RTX 3080 Ti, 12288, 2048, 10240, 27, 47, 110.25, 350.0, 610.62",
    ].join("\r\n");

    expect(parseNvidiaSmiGpuOutput(output)).toEqual([
      {
        uuid: "GPU-a",
        pci_bus_id: "00000000:01:00.0",
        index: 0,
        name: "NVIDIA GeForce RTX 3090",
        memory_total_mb: 24576,
        memory_used_mb: 1024,
        memory_free_mb: 23552,
        utilization_pct: 18,
        temp_c: 42,
        power_draw: 90.5,
        power_limit: 350,
      },
      {
        uuid: "GPU-b",
        pci_bus_id: "00000000:02:00.0",
        index: 1,
        name: "NVIDIA GeForce RTX 3080 Ti",
        memory_total_mb: 12288,
        memory_used_mb: 2048,
        memory_free_mb: 10240,
        utilization_pct: 27,
        temp_c: 47,
        power_draw: 110.25,
        power_limit: 350,
      },
    ]);
    expect(parseNvidiaSmiDriverVersion(output)).toBe("610.62");
  });

  test("returns no devices or driver for empty output", () => {
    expect(parseNvidiaSmiGpuOutput("\r\n")).toEqual([]);
    expect(parseNvidiaSmiDriverVersion("\r\n")).toBeNull();
  });
});
