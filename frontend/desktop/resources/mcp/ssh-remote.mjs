#!/usr/bin/env node
// Stdio MCP server exposing one remote machine over ssh (key auth only).
// Env: SSH_HOST (required, e.g. "user@host"), SSH_TIMEOUT_S (default 60).
// Newline-delimited JSON-RPC, matching the official MCP stdio transport.

import { execFile } from "node:child_process";
import { stdin, stdout, env, exit } from "node:process";

const HOST = env.SSH_HOST || "";
const TIMEOUT_S = Number(env.SSH_TIMEOUT_S || "60");
if (!HOST || !/^[A-Za-z0-9._@-]+$/.test(HOST) || HOST.startsWith("-")) {
  console.error("ssh-remote: SSH_HOST must be set to host or user@host");
  exit(1);
}

const tools = [
  {
    name: "run_command",
    description: `Run a shell command on ${HOST} and return stdout/stderr.`,
    inputSchema: {
      type: "object",
      properties: { command: { type: "string", description: "Shell command to run" } },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: `Read a text file from ${HOST}.`,
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: `Write a text file on ${HOST} (overwrites).`,
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "list_dir",
    description: `List a directory on ${HOST}.`,
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
];

function ssh(remoteCommand, input) {
  return new Promise((resolve) => {
    const child = execFile(
      "ssh",
      ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", HOST, remoteCommand],
      { timeout: TIMEOUT_S * 1000, maxBuffer: 8 * 1024 * 1024 },
      (error, out, err) => {
        resolve({
          ok: !error,
          stdout: String(out ?? ""),
          stderr: String(err ?? "") || (error ? String(error.message) : ""),
        });
      },
    );
    if (input !== undefined) child.stdin?.end(input);
    else child.stdin?.end();
  });
}

const shq = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

async function callTool(name, args) {
  switch (name) {
    case "run_command":
      return ssh(String(args.command ?? ""));
    case "read_file":
      return ssh(`cat ${shq(args.path)}`);
    case "write_file":
      return ssh(`cat > ${shq(args.path)}`, String(args.content ?? ""));
    case "list_dir":
      return ssh(`ls -la ${shq(args.path)}`);
    default:
      return { ok: false, stdout: "", stderr: `unknown tool ${name}` };
  }
}

const send = (message) => stdout.write(`${JSON.stringify(message)}\n`);

let buffer = "";
stdin.setEncoding("utf8");
stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\n");
    if (line) void handle(line);
  }
});
stdin.on("end", () => exit(0));

async function handle(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = message;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: `ssh-remote(${HOST})`, version: "1.0.0" },
      },
    });
  } else if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools } });
  } else if (method === "tools/call") {
    const result = await callTool(params?.name, params?.arguments ?? {});
    const text = result.ok
      ? result.stdout || "(no output)"
      : `ERROR: ${result.stderr || "command failed"}\n${result.stdout}`;
    send({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: text.slice(0, 200_000) }], isError: !result.ok },
    });
  } else if (id !== undefined) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method ${method}` } });
  }
}
