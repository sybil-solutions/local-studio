// CRITICAL
import { test, expect } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const BACKEND_URL = process.env.PLAYWRIGHT_BACKEND_URL ?? "http://localhost:8080";

test("chat: multi-step + agent files panel shows file content", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const backendOverride = BACKEND_URL;
  const health = await request.get(`${backendOverride}/health`).catch(() => null);
  test.skip(!health || !health.ok(), `Backend unavailable at ${backendOverride}`);

  await page.context().addCookies([{
    name: "vllmstudio_backend_url",
    value: backendOverride,
    url: BASE,
  }]);
  await page.addInitScript((url) => {
    window.localStorage.setItem("vllmstudio_backend_url", String(url));
  }, backendOverride);

  // Create a dedicated session to avoid relying on initial UI bootstrapping state.
  const created = await request.post(`${BACKEND_URL}/chats`, {
    data: { title: "Playwright Chat", model: null },
  });
  test.skip(!created.ok(), `Chat session API unavailable (${created.status()})`);
  const createdJson = await created.json() as { session?: { id: string } };
  const sessionId = createdJson.session?.id;
  expect(sessionId).toBeTruthy();

  await page.goto(`/chat?session=${encodeURIComponent(sessionId!)}`);

  // If setup wizard is shown, skip it.
  const skip = page.getByRole("button", { name: /skip for now/i });
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await page.goto(`/chat?session=${encodeURIComponent(sessionId!)}`);
  }

  // Ensure a model is selected (composer is disabled until then).
  const modelSelect = page.locator('select[title="Select model"]').first();
  if (await modelSelect.isVisible().catch(() => false)) {
    const chosen = await modelSelect.evaluate((el) => {
      const select = el as HTMLSelectElement;
      const options = Array.from(select.options);
      const candidate = options.find((o) => o.value && !o.disabled);
      return candidate?.value ?? null;
    });
    if (chosen) {
      await modelSelect.selectOption(chosen);
    }
  }

  const composer = page.locator(
    'textarea[placeholder="Message..."]:visible, textarea[placeholder^="Type here"]:visible',
  ).first();
  await expect(composer).toBeVisible();

  await composer.fill("Hello from Playwright");
  const sendButton = page.locator('button[title="Send"]:visible').first();
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  const stop = page.locator('button[title="Stop"]:visible').first();
  if (await stop.isVisible().catch(() => false)) {
    await stop.waitFor({ state: "hidden", timeout: 60_000 });
  }

  await expect(page.getByText("Hello from Playwright")).toBeVisible();

  await expect(composer).toBeVisible();
  await composer.fill("Second message: please confirm you can read this.");
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  // Inject an agent file via backend API so the Files tab has content to show.
  const filePath = "demo.txt";
  await request.put(`${BACKEND_URL}/chats/${encodeURIComponent(sessionId!)}/files/${encodeURIComponent(filePath)}`, {
    data: { content: "hello from agent file\\nline2\\n", encoding: "utf8" },
  });

  // Reload to force the chat bootstrap to refresh agent files.
  await page.goto(`/chat?session=${encodeURIComponent(sessionId!)}`);

  // Open the right sidebar and switch to Files.
  await page.getByTitle("Show activity").click();
  await page.getByRole("button", { name: "Files" }).click();

  // Select the file and confirm content renders.
  await page.getByRole("button", { name: /^demo\\.txt(\\s|$)/ }).first().click();
  await expect(page.getByText("hello from agent file")).toBeVisible();

  const shotPath = testInfo.outputPath("proof-chat-agent-files.png");
  await page.screenshot({ path: shotPath, fullPage: true });
});
