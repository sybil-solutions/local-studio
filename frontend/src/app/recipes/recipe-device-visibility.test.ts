// CRITICAL
import { describe, expect, it } from "vitest";
import { generateCommand } from "./recipe-command";
import { normalizeRecipeForEditor, prepareRecipeForSave } from "./recipe-utils";

describe("recipe device visibility normalization", () => {
  it("normalizes legacy CUDA aliases into visible_devices", () => {
    const normalized = normalizeRecipeForEditor({
      id: "r1",
      name: "test",
      model_path: "/models/test",
      extra_args: {
        CUDA_VISIBLE_DEVICES: "0",
        hip_visible_devices: "2",
      },
    });

    expect(normalized.visible_devices).toBe("0");
    expect(normalized.hip_visible_devices).toBe("2");
  });

  it("persists canonical visible-devices and removes legacy aliases", () => {
    const payload = prepareRecipeForSave({
      id: "r1",
      name: "test",
      model_path: "/models/test",
      visible_devices: "1",
      extra_args: {
        CUDA_VISIBLE_DEVICES: "2",
        custom_arg: "ok",
      },
    });

    expect(payload.extra_args?.["visible-devices"]).toBe("1");
    expect(payload.extra_args?.["CUDA_VISIBLE_DEVICES"]).toBeUndefined();
    expect(payload.extra_args?.["cuda_visible_devices"]).toBeUndefined();
    expect(payload.extra_args?.["custom_arg"]).toBe("ok");
  });

  it("does not leak visibility env keys into command preview", () => {
    const command = generateCommand({
      id: "r1",
      name: "test",
      model_path: "/models/test",
      visible_devices: "0",
      hip_visible_devices: "1",
      rocr_visible_devices: "2",
      extra_args: {
        custom_arg: "ok",
      },
    });

    expect(command).toContain("--custom-arg ok");
    expect(command).not.toContain("--visible-devices");
    expect(command).not.toContain("--cuda-visible-devices");
    expect(command).not.toContain("--hip-visible-devices");
    expect(command).not.toContain("--rocr-visible-devices");
  });
});
