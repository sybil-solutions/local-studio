import { expect, test } from "bun:test";
import { createRedactedRecordMultiplexer } from "./redacted-record-multiplexer";

const SECRET = "SYNTHETIC_MULTIPLEXER_SECRET";

test("assembles interleaved chunks in order and retains terminating stream labels", () => {
  const multiplexer = createRedactedRecordMultiplexer<"stdout" | "stderr">();

  expect(multiplexer.write("stdout", "ordinary stdout\n")).toEqual([
    { label: "stdout", value: "ordinary stdout", ending: "\n" },
  ]);
  expect(multiplexer.write("stdout", "api_")).toEqual([]);
  expect(multiplexer.write("stderr", "key")).toEqual([]);
  expect(multiplexer.write("stderr", "=")).toEqual([]);
  expect(multiplexer.write("stdout", `${SECRET}\r\nordinary second\n`)).toEqual([
    { label: "stdout", value: "api_key=[redacted]", ending: "\r\n" },
    { label: "stdout", value: "ordinary second", ending: "\n" },
  ]);
});

test("flushes no-newline records and fails closed after bounded overflow", () => {
  const noNewline = createRedactedRecordMultiplexer<"stdout">();
  noNewline.write("stdout", `password=${SECRET}`);
  expect(noNewline.flush()).toEqual([
    { label: "stdout", value: "password=[redacted]", ending: "" },
  ]);

  const overflow = createRedactedRecordMultiplexer<"stdout" | "stderr">(8);
  overflow.write("stdout", "api_key=");
  overflow.write("stderr", SECRET);
  expect(overflow.write("stderr", "\nordinary\n")).toEqual([
    { label: "stderr", value: "[redacted]", ending: "\n" },
    { label: "stderr", value: "[redacted]", ending: "\n" },
  ]);

  const singleChunk = createRedactedRecordMultiplexer<"stdout" | "stderr">(8);
  expect(singleChunk.write("stdout", `api_key${" ".repeat(64)}\n`)).toEqual([
    { label: "stdout", value: "[redacted]", ending: "\n" },
  ]);
  expect(singleChunk.writeRecord("stderr", SECRET)).toEqual([
    { label: "stderr", value: "[redacted]", ending: "" },
  ]);
});

test("feeds explicit error records through the existing ordered state", () => {
  const multiplexer = createRedactedRecordMultiplexer<"stdout" | "error">();
  expect(multiplexer.write("stdout", "api_key=\n")).toEqual([
    { label: "stdout", value: "api_key=", ending: "\n" },
  ]);
  expect(multiplexer.writeRecord("error", SECRET)).toEqual([
    { label: "error", value: "[redacted]", ending: "" },
  ]);
});

test("normalizes path and repeated separators across bounded chunks", () => {
  const multiplexer = createRedactedRecordMultiplexer<"stdout" | "stderr">();
  expect(multiplexer.write("stdout", "process.env.ACCESS_")).toEqual([]);
  expect(multiplexer.write("stderr", "TOKEN=")).toEqual([]);
  expect(multiplexer.write("stdout", `${SECRET}\n`)).toEqual([
    {
      label: "stdout",
      value: "process.env.ACCESS_TOKEN=[redacted]",
      ending: "\n",
    },
  ]);
  expect(multiplexer.write("stderr", `OPENAI__API__KEY=${SECRET}\n`)).toEqual([
    { label: "stderr", value: "OPENAI__API__KEY=[redacted]", ending: "\n" },
  ]);
  expect(multiplexer.write("stdout", `config.logging__level=${SECRET}\n`)).toEqual([
    { label: "stdout", value: `config.logging__level=${SECRET}`, ending: "\n" },
  ]);
});

test("retains encoded query intent across chunks and flush", () => {
  const multiplexer = createRedactedRecordMultiplexer<"stdout" | "stderr">();
  expect(multiplexer.write("stdout", "https://service.invalid/path?access%5F")).toEqual([]);
  expect(multiplexer.write("stderr", "token=\n")).toEqual([
    {
      label: "stderr",
      value: "https://service.invalid/path?access%5Ftoken=[redacted]",
      ending: "\n",
    },
  ]);
  expect(multiplexer.write("stdout", SECRET)).toEqual([]);
  expect(multiplexer.flush()).toEqual([
    { label: "stdout", value: "[redacted]", ending: "" },
  ]);
});
