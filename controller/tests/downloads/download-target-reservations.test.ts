import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  DownloadTargetConflict,
  DownloadTargetReservations,
} from "../../src/modules/engines/downloads/download-target-reservations";

const captureConflict = (operation: () => unknown): DownloadTargetConflict => {
  try {
    operation();
  } catch (error) {
    if (error instanceof DownloadTargetConflict) return error;
    throw error;
  }
  throw new Error("Expected a download target conflict");
};

describe("download target reservations", () => {
  test("normalizes equivalent targets and reports the active owner", () => {
    const reservations = new DownloadTargetReservations();
    const target = resolve("models", "shared");
    reservations.acquire(join(target, "nested", ".."), "active-download");

    const conflict = captureConflict(() => reservations.acquire(target, "blocked-download"));
    expect(conflict).toMatchObject({
      activeDownloadId: "active-download",
      target,
    });
    expect(conflict.message).not.toContain("blocked-download");
  });

  test("ignores a stale owner release after the target is reacquired", () => {
    const reservations = new DownloadTargetReservations();
    const target = resolve("models", "shared");
    const stale = reservations.acquire(target, "stale-download");
    reservations.release(stale);
    const active = reservations.acquire(target, "active-download");

    reservations.release(stale);
    expect(captureConflict(() => reservations.acquire(target, "blocked-download"))).toMatchObject({
      activeDownloadId: "active-download",
      target,
    });

    reservations.release(active);
    expect(reservations.acquire(target, "next-download")).toMatchObject({
      downloadId: "next-download",
      target,
    });
  });

  test("treats casing aliases as conflicts on case-insensitive hosts", () => {
    const reservations = new DownloadTargetReservations({ caseInsensitive: true });
    const target = resolve("models", "Shared");
    reservations.acquire(target, "active-download");

    expect(
      captureConflict(() => reservations.acquire(resolve("models", "shared"), "blocked-download")),
    ).toMatchObject({
      activeDownloadId: "active-download",
      target,
    });
  });

  test("treats non-existing Unicode normalization aliases as conflicts", () => {
    const directory = mkdtempSync(join(tmpdir(), "local-studio-download-target-unicode-"));
    const composed = join(directory, "caf\u00e9");
    const decomposed = join(directory, "cafe\u0301");

    try {
      expect(composed).not.toBe(decomposed);
      expect(existsSync(composed)).toBe(false);
      expect(existsSync(decomposed)).toBe(false);
      const reservations = new DownloadTargetReservations({ unicodeNormalization: "NFD" });
      reservations.acquire(composed, "active-download");

      expect(
        captureConflict(() => reservations.acquire(decomposed, "blocked-download")),
      ).toMatchObject({
        activeDownloadId: "active-download",
        target: composed,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("canonicalizes existing symlink ancestors before comparing targets", () => {
    const directory = mkdtempSync(join(tmpdir(), "local-studio-download-target-"));
    const physicalRoot = join(directory, "physical");
    const aliasRoot = join(directory, "alias");
    mkdirSync(physicalRoot);
    symlinkSync(physicalRoot, aliasRoot, process.platform === "win32" ? "junction" : "dir");

    try {
      const reservations = new DownloadTargetReservations();
      reservations.acquire(join(aliasRoot, "nested"), "active-download");

      expect(
        captureConflict(() =>
          reservations.acquire(join(physicalRoot, "nested"), "blocked-download"),
        ),
      ).toMatchObject({
        activeDownloadId: "active-download",
        target: join(aliasRoot, "nested"),
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test.each([
    ["descendant", resolve("models", "shared"), resolve("models", "shared", "nested")],
    ["ancestor", resolve("models", "shared", "nested"), resolve("models", "shared")],
  ])("rejects a %s target that overlaps an active tree", (_direction, active, blocked) => {
    const reservations = new DownloadTargetReservations();
    reservations.acquire(active, "active-download");

    expect(captureConflict(() => reservations.acquire(blocked, "blocked-download"))).toMatchObject({
      activeDownloadId: "active-download",
      target: active,
    });
  });

  test("permits targets that only share a path-segment prefix", () => {
    const reservations = new DownloadTargetReservations();
    const active = resolve("models", "shared");
    const distinct = resolve("models", "shared-copy");
    reservations.acquire(active, "active-download");

    expect(reservations.acquire(distinct, "distinct-download")).toMatchObject({
      downloadId: "distinct-download",
      target: distinct,
    });
  });
});
