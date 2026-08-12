import { describe, expect, test } from "bun:test";
import {
  isWindowsAbsolutePath,
  buildWslLaunchArguments,
} from "../src/modules/compute/launchers/wsl2";
import {
  normalizeWslOutput,
  parseWslQuietList,
  parseWslVerboseList,
} from "../src/modules/compute/wsl-platform";

describe("WSL2 discovery", () => {
  test("parses UTF-16-shaped verbose output without depending on the state language", () => {
    const output = [
      "  NAME                   STATE           VERSION",
      "* Ubuntu                 Parado          2",
      "  docker-desktop         Running         2",
      "  Legacy                 Stopped         1",
    ].join("\r\n");
    const nulOutput = [...output].map((character) => `${character}\0`).join("");

    expect(normalizeWslOutput(nulOutput)).toBe(output.trim());
    expect(parseWslVerboseList(nulOutput)).toEqual([
      { name: "Ubuntu", version: 2, default: true },
      { name: "docker-desktop", version: 2, default: false },
      { name: "Legacy", version: 1, default: false },
    ]);
  });

  test("parses running distribution names", () => {
    expect(parseWslQuietList("Ubuntu\0\r\0\n\0Debian\0")).toEqual(["Ubuntu", "Debian"]);
  });
});

describe("WSL2 launch contract", () => {
  test("recognizes drive and UNC paths without changing Linux paths", () => {
    expect(isWindowsAbsolutePath("F:\\Models\\Qwen model")).toBe(true);
    expect(isWindowsAbsolutePath("\\\\server\\models\\Qwen")).toBe(true);
    expect(isWindowsAbsolutePath("/mnt/f/Models/Qwen")).toBe(false);
    expect(isWindowsAbsolutePath("Qwen/Qwen3")).toBe(false);
  });

  test("passes dynamic values as argv and sorts the environment", () => {
    const args = buildWslLaunchArguments(
      "Ubuntu Dev",
      "/tmp/local-studio-nonce.pid",
      "/mnt/f/work space",
      "nonce",
      "/mnt/f/logs/model.log",
      ["/home/user/.local/bin/vllm", "serve", "/mnt/f/Models/Qwen model"],
      { ZED: "last", ALPHA: "first value" },
    );

    expect(args.slice(0, 7)).toEqual([
      "--distribution",
      "Ubuntu Dev",
      "--exec",
      "/usr/bin/setsid",
      "--wait",
      "/bin/sh",
      "-c",
    ]);
    expect(args).toContain("ALPHA=first value");
    expect(args).toContain("/home/user/.local/bin");
    expect(args).toContain("/mnt/f/logs/model.log");
    expect(args.indexOf("ALPHA=first value")).toBeLessThan(args.indexOf("ZED=last"));
    expect(args.slice(-3)).toEqual([
      "/home/user/.local/bin/vllm",
      "serve",
      "/mnt/f/Models/Qwen model",
    ]);
  });

  test("keeps a planned managed home path isolated as one argument", () => {
    const args = buildWslLaunchArguments(
      "Ubuntu",
      "/tmp/local-studio-nonce.pid",
      "",
      "nonce",
      "/mnt/f/logs/model.log",
      ["~/.local/share/local-studio/runtime/venvs/vllm-latest/bin/vllm", "serve"],
      {},
    );

    expect(args.slice(-2)).toEqual([
      "~/.local/share/local-studio/runtime/venvs/vllm-latest/bin/vllm",
      "serve",
    ]);
  });
});
