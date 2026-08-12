import { describe, expect, test } from "bun:test";
import { resolveSystemEnvironmentHost } from "../src/modules/system/routes";

describe("system environment URLs", () => {
  test("uses the configured loopback host for a local Windows controller", () => {
    expect(resolveSystemEnvironmentHost("127.0.0.1", "win32", "pipeline")).toBe("127.0.0.1");
    expect(resolveSystemEnvironmentHost("localhost", "win32", "pipeline")).toBe("localhost");
  });

  test("preserves the existing hostname behavior on macOS and Linux", () => {
    expect(resolveSystemEnvironmentHost("127.0.0.1", "darwin", "mac-studio")).toBe("mac-studio");
    expect(resolveSystemEnvironmentHost("127.0.0.1", "linux", "gpu-host")).toBe("gpu-host");
  });
});
