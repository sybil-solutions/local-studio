import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electron = require("electron");
const devServerUrl = "http://127.0.0.1:3000";

await new Promise((resolve) => setTimeout(resolve, 3000));

const child = spawn(electron, ["desktop/dist/main.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    LOCAL_STUDIO_DESKTOP_DEV_SERVER_URL: devServerUrl,
  },
});

child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
