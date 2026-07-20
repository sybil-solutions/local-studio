import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realProcessRunner, type ProcessRunner } from "../../src/core/command";
import {
  listProcessInventory,
  normalizeProcessStartIdentity,
  parseInventoryLine,
  readProcessInventory,
} from "../../src/modules/engines/process/process-inventory";

const runnerWithOutput = (stdout: string, status = 0): ProcessRunner => ({
  readProcessEnvironmentVariable: () => ({ status: "unavailable" }),
  runSync: () => ({ status, stdout, stderr: "" }),
  signalProcessGroup: () => false,
  spawnDetached: (): never => {
    throw new Error("Unexpected spawn");
  },
});

test("parses PGID, stable start identity, state, and quoted argv", () => {
  expect(
    parseInventoryLine(
      '42000 1 42000 Fri Jul 17 12:00:00 2026 S python "model with spaces" --port 8000',
    ),
  ).toEqual({
    pid: 42_000,
    ppid: 1,
    processGroupId: 42_000,
    startIdentity: String(Date.parse("Fri Jul 17 12:00:00 2026")),
    stat: "S",
    command: 'python "model with spaces" --port 8000',
    args: ["python", "model with spaces", "--port", "8000"],
  });
});

test("normalizes local ps start times to the same instant across time zones", () => {
  const originalTimezone = process.env.TZ;
  try {
    process.env.TZ = "UTC";
    const utc = normalizeProcessStartIdentity("Fri Jul 17 10:00:00 2026");
    process.env.TZ = "Europe/Warsaw";
    const warsaw = normalizeProcessStartIdentity("Fri Jul 17 12:00:00 2026");
    process.env.TZ = "America/New_York";
    const newYork = normalizeProcessStartIdentity("Fri Jul 17 06:00:00 2026");
    expect([utc, warsaw, newYork]).toEqual(["1784282400000", "1784282400000", "1784282400000"]);
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test("rejects legacy or malformed inventory lines", () => {
  expect(parseInventoryLine("42000 1 S VLLM::Worker")).toBeNull();
  expect(parseInventoryLine("not a process row")).toBeNull();
});

test("one malformed row makes the security inventory unavailable", () => {
  const runner = runnerWithOutput("42000 1 42000 Fri Jul 17 12:00:00 2026 S python\nmalformed");

  expect(readProcessInventory(runner).status).toBe("unavailable");
  expect(listProcessInventory(runner)).toHaveLength(1);
});

test("reports command failure and empty inventory distinctly", () => {
  expect(readProcessInventory(runnerWithOutput("", 1))).toEqual({
    status: "unavailable",
    entries: [],
  });
  expect(readProcessInventory(runnerWithOutput(""))).toEqual({
    status: "available",
    entries: [],
  });
});

test("forces the fake process inventory command into the stable C locale", () => {
  const previousLanguage = process.env["LANGUAGE"];
  const previousLang = process.env["LANG"];
  process.env["LANGUAGE"] = "pl_PL:pl";
  process.env["LANG"] = "pl_PL.UTF-8";
  try {
    const runner: ProcessRunner = {
      ...runnerWithOutput(""),
      runSync: (_command, _args, options) => ({
        status:
          options?.env?.["LC_ALL"] === "C" &&
          options.env["LANG"] === "C" &&
          options.env["LANGUAGE"] === "C"
            ? 0
            : 1,
        stdout: "42000 1 42000 Fri Jul 17 12:00:00 2026 S python --port 8000",
        stderr: "",
      }),
    };

    expect(readProcessInventory(runner)).toMatchObject({
      status: "available",
      entries: [{ pid: 42_000, processGroupId: 42_000 }],
    });
  } finally {
    if (previousLanguage === undefined) delete process.env["LANGUAGE"];
    else process.env["LANGUAGE"] = previousLanguage;
    if (previousLang === undefined) delete process.env["LANG"];
    else process.env["LANG"] = previousLang;
  }
});

test("real process execution ignores a localized ambient inventory locale", () => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-ps-locale-"));
  const executable = join(directory, "ps");
  const previousPath = process.env["PATH"];
  const previousLocale = process.env["LC_ALL"];
  writeFileSync(
    executable,
    '#!/bin/sh\n[ "$LC_ALL" = "C" ] || exit 9\nprintf "42001 1 42001 Fri Jul 17 12:00:00 2026 S python --port 8000\\n"\n',
  );
  chmodSync(executable, 0o755);
  process.env["PATH"] = directory;
  process.env["LC_ALL"] = "pl_PL.UTF-8";
  try {
    expect(readProcessInventory(realProcessRunner)).toMatchObject({
      status: "available",
      entries: [{ pid: 42_001, processGroupId: 42_001 }],
    });
  } finally {
    if (previousPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = previousPath;
    if (previousLocale === undefined) delete process.env["LC_ALL"];
    else process.env["LC_ALL"] = previousLocale;
    rmSync(directory, { recursive: true, force: true });
  }
});
