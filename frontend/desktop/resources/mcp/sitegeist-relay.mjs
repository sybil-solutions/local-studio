#!/usr/bin/env node
import { stdin, stdout } from "node:process";

let nextId = 1;
let buffer = Buffer.alloc(0);

const baseUrl = () => process.env.SITEGEIST_RELAY_URL || "http://127.0.0.1:7717";
const token = () => process.env.SITEGEIST_RELAY_TOKEN || "";
const sessionId = () => process.env.SITEGEIST_RELAY_SESSION_ID || "";

const tools = [
  ["relay_health", "Report Sitegeist relay health.", {}],
  ["relay_capabilities", "List methods exposed by the connected Sitegeist extension.", {}],
  ["browser_navigate", "Navigate the active Brave tab.", { url: "string" }],
  ["browser_url", "Read the active tab URL and title.", {}],
  ["browser_text", "Read visible page text.", { selector: "string" }],
  ["browser_html", "Read page HTML.", { selector: "string" }],
  [
    "browser_screenshot",
    "Capture a page screenshot as a data URL.",
    { fullPage: "boolean", selector: "string" },
  ],
  [
    "browser_click",
    "Click a selector or coordinate.",
    { selector: "string", x: "number", y: "number" },
  ],
  [
    "browser_fill",
    "Fill an input selector.",
    { selector: "string", value: "string", submit: "boolean" },
  ],
  ["browser_scroll", "Scroll the page.", { dx: "number", dy: "number", selector: "string" }],
  ["browser_eval", "Evaluate JavaScript in the page context.", { expression: "string" }],
  ["browser_tabs_list", "List browser tabs.", {}],
  ["browser_tabs_new", "Open a new tab.", { url: "string" }],
  ["browser_tabs_switch", "Switch to a tab id.", { id: "string" }],
  ["browser_tabs_close", "Close a tab id.", { id: "string" }],
].map(([name, description, shape]) => ({
  name,
  description,
  inputSchema: {
    type: "object",
    properties: Object.fromEntries(Object.entries(shape).map(([key, type]) => [key, { type }])),
  },
}));

function toRelayMethod(name) {
  return name
    .replace(/^relay_/, "relay.")
    .replace(/^browser_tabs_/, "browser.tabs.")
    .replace(/^browser_/, "browser.");
}

function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  stdout.write(body);
}

function textResult(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

async function callRelay(method, params) {
  const headers = {
    "content-type": "application/json",
    ...(token() ? { authorization: `Bearer ${token()}` } : {}),
    ...(sessionId() ? { "x-sitegeist-session": sessionId() } : {}),
  };
  const response = await fetch(`${baseUrl().replace(/\/+$/, "")}/rpc`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || `Sitegeist relay returned ${response.status}`);
  }
  return payload.result;
}

async function handle(message) {
  try {
    if (message.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "sitegeist-relay", version: "1.0.0" },
        },
      });
      return;
    }
    if (message.method === "tools/list") {
      send({ jsonrpc: "2.0", id: message.id, result: { tools } });
      return;
    }
    if (message.method === "tools/call") {
      const name = message.params?.name;
      const args = message.params?.arguments || {};
      if (!tools.some((tool) => tool.name === name)) throw new Error(`Unknown tool: ${name}`);
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: textResult(await callRelay(toRelayMethod(name), args)),
      });
      return;
    }
    if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, result: {} });
  } catch (error) {
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
    });
  }
}

function onData(chunk) {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const length = Number(/content-length:\s*(\d+)/i.exec(header)?.[1]);
    if (!Number.isFinite(length)) {
      buffer = Buffer.alloc(0);
      return;
    }
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) return;
    const body = buffer.slice(bodyStart, bodyEnd).toString("utf8");
    buffer = buffer.slice(bodyEnd);
    try {
      void handle(JSON.parse(body));
    } catch {
      // Ignore malformed notifications.
    }
  }
}

stdin.on("data", onData);
