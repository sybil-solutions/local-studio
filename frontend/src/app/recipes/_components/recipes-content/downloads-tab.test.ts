import { describe, expect, it } from "vitest";
import { downloadCompletedText, downloadProgressText, downloadSpeedText } from "./downloads-tab";

describe("DownloadsTab formatters", () => {
  it("does not fake percentage progress when total bytes are unavailable", () => {
    expect(downloadProgressText({ downloaded_bytes: 1024, total_bytes: null })).toBe(
      "1.0 KB / unavailable",
    );
  });

  it("formats progress, speed, and completed timestamps when available", () => {
    expect(downloadProgressText({ downloaded_bytes: 50, total_bytes: 200 })).toBe(
      "50 B / 200 B · 25%",
    );
    expect(downloadSpeedText({ speed_bytes_per_second: 2048 })).toBe("2.0 KB/s");
    expect(
      downloadCompletedText({
        status: "completed",
        completed_at: "2026-05-10T10:00:00.000Z",
        updated_at: "2026-05-10T09:00:00.000Z",
      }),
    ).toBe("done 2026-05-10T10:00:00.000Z");
  });
});
