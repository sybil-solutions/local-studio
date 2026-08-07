import { writeFileSync } from "node:fs";

const mode = process.argv[2] ?? "normal";
const limit = Number(process.argv[3]);
const pidFile = process.argv[4];
let buffer = "";
let callCount = 0;

if (pidFile) writeFileSync(pidFile, String(process.pid));
setInterval(() => undefined, 1_000);

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const response = (message, result) => ({ jsonrpc: "2.0", id: message.id, result });

const initialize = (message) => {
  if (mode === "overflow-initialize") {
    process.stdout.write(Buffer.alloc(limit + 1, 97));
    return;
  }
  if (mode === "malformed-initialize") {
    process.stdout.write("{]\n");
    return;
  }
  if (mode === "invalid-rpc-initialize") {
    send({ invalid: true });
    return;
  }
  const payload = JSON.stringify(
    response(message, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "fixture-€", version: "1.0.0" },
    }),
  );
  if (mode === "split-utf8") {
    const bytes = Buffer.from(`${payload}\n`);
    const marker = bytes.indexOf(Buffer.from("€"));
    process.stdout.write(bytes.subarray(0, marker + 1));
    setTimeout(() => process.stdout.write(bytes.subarray(marker + 1)), 5);
    return;
  }
  process.stdout.write(`${payload}\n`);
};

const listTools = (message) => {
  if (mode === "overflow-list") {
    process.stdout.write(Buffer.alloc(limit + 1, 97));
    return;
  }
  if (mode === "malformed-list") {
    process.stdout.write("{]\n");
    return;
  }
  if (mode === "malformed-then-response") {
    const payload = JSON.stringify(
      response(message, {
        tools: [{ name: "must-not-arrive", inputSchema: { type: "object" } }],
      }),
    );
    process.stdout.write(`{]\n${payload}\n`);
    return;
  }
  if (mode === "invalid-rpc-list") {
    send({ invalid: true });
    return;
  }
  const result = response(message, {
    tools: [{ name: mode, inputSchema: { type: "object" } }],
  });
  const payload = JSON.stringify(result);
  if (mode === "exact-limit") {
    process.stdout.write(`${payload}${" ".repeat(limit - Buffer.byteLength(payload) - 1)}\n`);
    return;
  }
  if (mode === "near-limit-split-next-frame") {
    const frame = Buffer.from(`${payload}${" ".repeat(limit - Buffer.byteLength(payload) - 1)}\n`);
    const next = Buffer.from(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" })}\n`,
    );
    const splitAt = frame.length - 1_024;
    process.stdout.write(frame.subarray(0, splitAt));
    setTimeout(() => process.stdout.write(Buffer.concat([frame.subarray(splitAt), next])), 5);
    return;
  }
  if (mode === "multiple-frames") {
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" })}\n${payload}\n`,
    );
    return;
  }
  process.stdout.write(`${payload}\n`);
};

const handle = (message) => {
  if (message.method === "initialize") {
    initialize(message);
    return;
  }
  if (message.method === "tools/list") {
    listTools(message);
    return;
  }
  if (message.method === "tools/call" && mode === "pending-malformed") {
    callCount += 1;
    if (callCount === 2) process.stdout.write("{]\n");
    return;
  }
  if (message.id !== undefined) send(response(message, { content: [] }));
};

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.trim()) handle(JSON.parse(line));
    newline = buffer.indexOf("\n");
  }
});
