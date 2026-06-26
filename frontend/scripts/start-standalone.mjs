import { cpSync, existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(thisFile), "..");
const standaloneRoot = resolve(projectRoot, ".next", "standalone");

if (!existsSync(standaloneRoot)) {
  console.error('Missing ".next/standalone". Run "npm run build" first.');
  process.exit(1);
}

const copyDirectory = (from, to) => {
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
};

// Check if frontend directory exists inside standalone, which means monorepo or nested structure
const frontendStandalone = resolve(standaloneRoot, "frontend");
let serverRoot = standaloneRoot;

if (existsSync(frontendStandalone)) {
  console.log("Detected nested frontend structure in standalone build.");
  serverRoot = frontendStandalone;
  
  // We need to copy public and static to the nested location too, or just run from there
  // The server.js is likely in frontend/server.js
}

console.log(`Starting server from: ${serverRoot}`);

copyDirectory(resolve(projectRoot, "public"), resolve(serverRoot, "public"));
copyDirectory(resolve(projectRoot, ".next", "static"), resolve(serverRoot, ".next", "static"));

const server = spawn("node", ["server.js"], {
  cwd: serverRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    LOCAL_STUDIO_AGENT_CWD: process.env.LOCAL_STUDIO_AGENT_CWD || resolve(projectRoot, ".."),
  },
});

server.on("exit", (code) => process.exit(code ?? 0));

