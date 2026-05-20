import { describe, expect, it } from "vitest";
import {
  clampComputerWidth,
  computerSnapWidths,
  gentlySnapComputerWidth,
  uniqueComputerTabs,
} from "./persistence";

describe("computer panel width helpers", () => {
  it("uses the requested percentage snap widths inside the available bounds", () => {
    expect(computerSnapWidths(1200)).toEqual([300, 420, 600, 780]);
  });

  it("only snaps when the dropped width is close to a snap point", () => {
    expect(gentlySnapComputerWidth(424, 1200)).toBe(420);
    expect(gentlySnapComputerWidth(470, 1200)).toBe(470);
  });

  it("keeps the chat side usable when clamping wide computer widths", () => {
    expect(clampComputerWidth(900, 1200)).toBe(780);
  });

  it("keeps status as the anchor while allowing multiple open computer tabs", () => {
    expect(uniqueComputerTabs(["browser", "files", "browser"])).toEqual([
      "status",
      "browser",
      "files",
    ]);
  });
});
