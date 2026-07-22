import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const frontendPort = 43_220;
const runtimePort = 43_221;
const controllerPort = 43_222;
const baseURL = `http://127.0.0.1:${frontendPort}`;
const dataDir = mkdtempSync(path.join(os.tmpdir(), "local-studio-controller-e2e-data-"));
const homeDir = mkdtempSync(path.join(os.tmpdir(), "local-studio-controller-e2e-home-"));
writeFileSync(
  path.join(dataDir, "api-settings.json"),
  JSON.stringify({ backendUrl: `http://127.0.0.1:${controllerPort}`, apiKey: "" }),
);
const controllerScript = path.resolve(__dirname, "fixtures", "fake-controller.mjs");
const startScript = path.resolve(__dirname, "..", "scripts", "start-standalone.mjs");

export default defineConfig({
  testDir: ".",
  testMatch: ["controller-agent.spec.ts"],
  outputDir: "../test-results/controller-agent",
  workers: 1,
  retries: 0,
  reporter: [["line"]],
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL,
    viewport: { width: 1440, height: 960 },
    colorScheme: "dark",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `PORT=${controllerPort} node ${controllerScript}`,
      url: `http://127.0.0.1:${controllerPort}/health`,
      timeout: 15_000,
      reuseExistingServer: false,
    },
    {
      command: [
        `PORT=${frontendPort}`,
        `HOME=${homeDir}`,
        `LOCAL_STUDIO_AGENT_RUNTIME_URL=http://127.0.0.1:${runtimePort}`,
        `LOCAL_STUDIO_DATA_DIR=${dataDir}`,
        `node ${startScript}`,
      ].join(" "),
      url: `${baseURL}/api/desktop-health`,
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
});
