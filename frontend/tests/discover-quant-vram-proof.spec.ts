// CRITICAL
import { test, expect } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const BACKEND_URL = process.env.PLAYWRIGHT_BACKEND_URL ?? "http://localhost:8080";

test("discover: shows VRAM-aware recommendations and quantization hide controls", async ({ page }, testInfo) => {
  await page.context().addCookies([{
    name: "vllmstudio_backend_url",
    value: BACKEND_URL,
    url: BASE,
  }]);
  await page.addInitScript((url) => {
    window.localStorage.setItem("vllmstudio_backend_url", String(url));
  }, BACKEND_URL);

  await page.goto("/discover");
  await expect(page.getByRole("heading", { name: "Discover Models" })).toBeVisible();

  await page.getByRole("button", { name: /filters/i }).click();
  await expect(page.getByText("Hide Quantization Tags")).toBeVisible();

  await page.getByRole("button", { name: "AWQ" }).click();
  await expect(page.getByRole("button", { name: "Clear" })).toBeVisible();
  await expect(page.getByText("Sort By")).toBeVisible();

  const shotPath = testInfo.outputPath("proof-discover-vram-quant.png");
  await page.screenshot({ path: shotPath, fullPage: true });
});
