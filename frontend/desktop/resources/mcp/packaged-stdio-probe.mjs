let buffer = "";
let bootstrapped = false;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\n");
    const message = JSON.parse(line);
    if (!bootstrapped) {
      const environment = message.environment;
      const keys = environment && typeof environment === "object" ? Object.keys(environment) : [];
      const secret = environment?.LOCAL_STUDIO_PACKAGED_PROBE_TOKEN;
      if (
        message.localStudioBootstrap !== "v1" ||
        keys.length !== 1 ||
        keys[0] !== "LOCAL_STUDIO_PACKAGED_PROBE_TOKEN" ||
        typeof secret !== "string" ||
        secret.length < 32 ||
        process.argv.some((value) => value.includes(secret)) ||
        Object.values(process.env).some((value) => value?.includes(secret))
      ) {
        process.exit(1);
      }
      process.env.LOCAL_STUDIO_PACKAGED_PROBE_TOKEN = secret;
      bootstrapped = true;
      process.stdout.write('{"localStudioBootstrap":"ready"}\n');
      continue;
    }
    const result =
      message.method === "initialize"
        ? {
            protocolVersion: "2025-03-26",
            capabilities: {},
            serverInfo: { name: "packaged", version: "1.0.0" },
          }
        : message.method === "tools/list" && process.env.LOCAL_STUDIO_PACKAGED_PROBE_TOKEN
          ? { tools: [{ name: "packaged-runtime-ready", inputSchema: { type: "object" } }] }
          : {};
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
  }
});
