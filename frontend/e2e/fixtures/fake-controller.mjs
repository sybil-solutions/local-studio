import { createServer } from "node:http";

const port = Number(process.env.PORT) || 43220;

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  for await (const _chunk of request) void _chunk;
}

async function streamCompletion(request, response) {
  await readBody(request);
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  const id = `controller-${Date.now()}`;
  const chunks = ["Controller", " scoped", " Pi", " reply."];
  response.write(`data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "controller-model",
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
  })}\n\n`);
  for (const content of chunks) {
    response.write(`data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "controller-model",
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
    })}\n\n`);
  }
  response.write(`data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "controller-model",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  })}\n\n`);
  response.write("data: [DONE]\n\n");
  response.end();
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/health") return json(response, 200, { ok: true });
  if (url.pathname === "/v1/models") {
    return json(response, 200, {
      object: "list",
      data: [{ id: "controller-model", object: "model" }],
    });
  }
  if (url.pathname === "/v1/chat/completions" && request.method === "POST") {
    return streamCompletion(request, response);
  }
  return json(response, 404, { error: "not found" });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`fake controller: http://127.0.0.1:${port}`);
});
