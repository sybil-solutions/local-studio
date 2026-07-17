import { defineConfig } from "@playwright/test";

const port = 43_210;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["line"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  expect: { timeout: 10_000 },
  timeout: 180_000,
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    viewport: { width: 1440, height: 960 },
    colorScheme: "dark",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: {
      mode: "on",
      size: { width: 1440, height: 960 },
      show: {
        actions: { duration: 650, position: "bottom-right", fontSize: 14 },
        test: { level: "step", position: "top-left", fontSize: 14 },
      },
    },
  },
  webServer: {
    command: `PORT=${port} LOCAL_STUDIO_AGENT_RUNTIME_URL=http://127.0.0.1:43211 node scripts/start-standalone.mjs`,
    url: `${baseURL}/api/desktop-health`,
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
  },
});
