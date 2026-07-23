import { describe, expect, it } from "vitest";
import { automationRunError } from "../src/automation-scheduler";

describe("automationRunError", () => {
  it("preserves runtime errors", () => {
    expect(automationRunError("Model is unavailable", "")).toBe("Model is unavailable");
  });

  it("rejects empty assistant responses", () => {
    expect(automationRunError(null, "  ")).toBe(
      "Automation completed without an assistant response.",
    );
  });

  it("accepts a non-empty assistant response", () => {
    expect(automationRunError(null, "AUTOMATION_SMOKE_OK")).toBeNull();
  });
});
