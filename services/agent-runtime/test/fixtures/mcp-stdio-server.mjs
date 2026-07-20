import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const mode = process.argv[2];
const limit = Number(process.argv[3]);
let callCount = 0;
const serverRequest =
  mode === "ping-string"
    ? { jsonrpc: "2.0", id: "server-ping", method: "ping" }
    : mode === "ping-number"
      ? { jsonrpc: "2.0", id: 0, method: "ping" }
      : mode === "unsupported-request"
        ? {
            jsonrpc: "2.0",
            id: "server-unsupported",
            method: "sampling/createMessage",
            params: { prompt: "fixture" },
          }
        : null;
let serverRequestHandled = serverRequest === null;
let serverRequestAnswered = serverRequest === null;
let pendingToolsRequest = null;
const concurrentCalls = [];

setInterval(() => undefined, 1000);

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const respond = (message, result) => send({ jsonrpc: "2.0", id: message.id, result });
const exactKeys = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");

const handledServerResponse = (message) => {
  if (!serverRequest || message.id !== serverRequest.id) return false;
  if (serverRequest.method === "ping") {
    return exactKeys(message, ["jsonrpc", "id", "result"]) && exactKeys(message.result, []);
  }
  return (
    exactKeys(message, ["jsonrpc", "id", "error"]) &&
    exactKeys(message.error, ["code", "message"]) &&
    message.error.code === -32601 &&
    message.error.message === "Method not found"
  );
};

const respondWithServerRequestState = (message) =>
  respond(message, {
    tools: [
      { name: serverRequestHandled ? "handled" : "invalid", inputSchema: { type: "object" } },
    ],
  });

if (mode === "stderr-flood") {
  process.stderr.write(Buffer.alloc(1024 * 1024, 120));
  process.stderr.write("\nfinal-diagnostic\n", () => process.exit(1));
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.localStudioBootstrap === "v1") {
    if (mode === "bootstrap-timeout") return;
    if (mode === "bootstrap-malformed") {
      process.stdout.write("{]\n");
      return;
    }
    if (mode === "pre-ready-notification") {
      send({ jsonrpc: "2.0", method: "notifications/fixture", params: { progress: 1 } });
      return;
    }
    if (mode === "pre-ready-response") {
      send({ jsonrpc: "2.0", id: 1, result: {} });
      return;
    }
    if (mode === "duplicate-bootstrap") {
      process.stdout.write(
        `${JSON.stringify({ localStudioBootstrap: "ready" })}\n${JSON.stringify({ localStudioBootstrap: "ready" })}\n`,
      );
      return;
    }
    if (mode === "ready-notification-same-chunk") {
      process.stdout.write(
        `${JSON.stringify({ localStudioBootstrap: "ready" })}\n${JSON.stringify({ jsonrpc: "2.0", method: "notifications/fixture", params: { progress: 1 } })}\n`,
      );
      return;
    }
    send({ localStudioBootstrap: "ready" });
    return;
  }
  if (message.method === "notifications/initialized") {
    if (serverRequest) send(serverRequest);
    return;
  }
  if (message.method === undefined && ("result" in message || "error" in message)) {
    serverRequestHandled = handledServerResponse(message);
    serverRequestAnswered = true;
    if (pendingToolsRequest) {
      respondWithServerRequestState(pendingToolsRequest);
      pendingToolsRequest = null;
    }
    return;
  }
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    if (mode === "limit-plus-one") {
      process.stdout.write(Buffer.alloc(limit + 1, 32));
      return;
    }
    if (mode === "invalid-utf8") {
      process.stdout.write(Buffer.from([0xff, 0x0a]));
      return;
    }
    if (mode === "malformed-json") {
      process.stdout.write("{]\n");
      return;
    }
    if (mode === "blank-frame") {
      process.stdout.write("\n");
      return;
    }
    if (mode === "whitespace-frame") {
      process.stdout.write(" \t\r\n");
      return;
    }
    if (mode === "invalid-rpc-schema") {
      send({ jsonrpc: "2.0", id: null, result: {} });
      return;
    }
    if (mode === "invalid-rpc-shape") {
      send({ jsonrpc: "2.0", result: {} });
      return;
    }
    if (mode === "eof-partial") {
      process.stdout.write('{"jsonrpc":"2.0"', () => process.exit(0));
      return;
    }
    if (mode === "stdout-partial-live") {
      process.stdout.end('{"jsonrpc":"2.0"');
      return;
    }
    if (mode === "stdout-clean-live") {
      process.stdout.end();
      return;
    }
    if (mode === "notification") {
      send({ jsonrpc: "2.0", method: "notifications/fixture", params: { progress: 1 } });
    }
    if (mode === "notification-no-params") {
      send({ jsonrpc: "2.0", method: "notifications/fixture" });
    }
    const invalidParams = {
      "scalar-notification-params": 1,
      "array-notification-params": [],
      "null-notification-params": null,
    };
    if (Object.hasOwn(invalidParams, mode)) {
      send({ jsonrpc: "2.0", method: "notifications/progress", params: invalidParams[mode] });
      return;
    }
    if (mode === "scalar-request-params") {
      send({ jsonrpc: "2.0", id: "server-request", method: "ping", params: 1 });
      return;
    }
    if (mode === "malformed-close") {
      process.stdout.write("{]\n", () => setTimeout(() => process.exit(0), 5));
      return;
    }
    const response = JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        serverInfo: { name: "fixture", version: "1.0.0" },
      },
    });
    if (mode === "initialize-response-exit") {
      process.stdout.write(`${response}\n`, () => process.exit(0));
      return;
    }
    if (mode === "exact-limit") {
      process.stdout.write(`${response}${" ".repeat(limit - Buffer.byteLength(response))}\n`);
      return;
    }
    if (mode === "json-whitespace") {
      process.stdout.write(` \t${response}\r \n`);
      return;
    }
    process.stdout.write(`${response}\n`);
    return;
  }
  if (message.method === "tools/list") {
    if (mode === "parent-exit-descendant") {
      spawn(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], {
        stdio: ["ignore", "inherit", "ignore"],
      });
      process.exit(0);
    }
    if (mode === "final-response-exit") {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "final", inputSchema: { type: "object" } }] } })}\n`,
        () => process.exit(0),
      );
      return;
    }
    if (serverRequest) {
      if (!serverRequestAnswered) {
        pendingToolsRequest = message;
        return;
      }
      respondWithServerRequestState(message);
      return;
    }
    respond(message, {
      tools: [{ name: String(process.pid), inputSchema: { type: "object" } }],
    });
    return;
  }
  if (message.method === "tools/call" && mode === "pending-malformed") {
    callCount += 1;
    if (callCount === 2) process.stdout.write("{]\n");
    return;
  }
  if (message.method === "tools/call" && mode === "concurrent-reverse-notification") {
    concurrentCalls.push(message);
    if (concurrentCalls.length === 2) {
      const [first, second] = concurrentCalls;
      process.stdout.write(
        [
          JSON.stringify({ jsonrpc: "2.0", method: "notifications/fixture" }),
          JSON.stringify({
            jsonrpc: "2.0",
            id: second.id,
            result: { content: [{ type: "text", text: second.params.name }] },
          }),
          JSON.stringify({
            jsonrpc: "2.0",
            id: first.id,
            result: { content: [{ type: "text", text: first.params.name }] },
          }),
        ].join("\n") + "\n",
      );
    }
    return;
  }
  if (message.method !== "tools/call" || mode !== "request-timeout") {
    respond(message, { content: [] });
  }
});
