import { createInterface } from "node:readline";

const reply = (id, result) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    reply(message.id, {
      protocolVersion: message.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "connector-test", version: "1" },
    });
  } else if (message.method === "tools/list") {
    reply(message.id, {
      tools: [
        { name: "read", inputSchema: { type: "object" } },
        { name: "write", inputSchema: { type: "object" } },
      ],
    });
  } else if (message.method === "tools/call") {
    reply(message.id, {
      content: [{ type: "text", text: `${message.params.name}:called` }],
    });
  }
});
