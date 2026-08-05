import { expect, test, type Page } from "@playwright/test";

async function openControllerChat(page: Page, title: string) {
  await page.goto(`/agent?new=${encodeURIComponent(title)}`);
  await expect(page.getByRole("button", { name: /^Model:/ }).first()).toBeEnabled({
    timeout: 60_000,
  });
  return page.getByPlaceholder(/Do anything|Ask for follow-up changes/).first();
}

for (const route of [
  "/",
  "/agent",
  "/agent/automations",
  "/configure",
  "/logs",
  "/quick",
  "/settings",
  "/setup",
  "/usage",
]) {
  test(`${route} renders without a browser error`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(route);
    expect(response?.ok()).toBeTruthy();
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
    await expect(page.getByText(/application error/i)).toHaveCount(0);
    if (route === "/setup") {
      await expect(page.getByRole("textbox", { name: "Where model weights live" })).toHaveValue(
        "/models",
      );
      await expect(page.getByText(/controller is unreachable/i)).toHaveCount(0);
    }
  });
}

for (const [route, destination] of [
  ["/discover", "/configure?section=models#models"],
  ["/integrations", "/configure?section=integrations#integrations"],
  ["/recipes", "/configure?section=models#models"],
  ["/server", "/configure?section=server#server"],
] as const) {
  test(`${route} redirects to ${destination}`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.ok()).toBeTruthy();
    expect(
      new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash,
    ).toBe(destination);
  });
}

test("Pi defaults to the active controller and reveals other models on request", async ({
  page,
}) => {
  await page.goto(`/agent?new=${encodeURIComponent("Controller scoped chat")}`);
  const picker = page.getByRole("button", { name: /^Model:/ }).first();
  await expect(picker).toBeEnabled({ timeout: 60_000 });
  await expect(picker).toHaveAccessibleName(/controller-model/);
  await expect(page.getByRole("button", { name: "Browser tools" })).toBeVisible();
  await picker.click();
  await page.getByRole("menuitem", { name: /^Model\b/ }).click();
  await expect(page.getByRole("menuitemradio", { name: "controller-model" })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "other-model" })).toHaveCount(0);
  await page.getByRole("menuitemcheckbox", { name: /Other models/ }).click();
  await expect(page.getByRole("menuitemradio", { name: "other-model" })).toBeVisible();
  await page.keyboard.press("Escape");

  const composer = page.getByPlaceholder(/Do anything|Ask for follow-up changes/).first();
  await composer.fill("Reply from this controller.");
  await composer.press("Enter");
  await expect(page.getByText("Controller scoped Pi reply.")).toBeVisible({ timeout: 60_000 });
});

test("messages containing /goal reach Pi as ordinary text", async ({ page }) => {
  const composer = await openControllerChat(page, "Goal text chat");
  const transcript = page.getByRole("article");
  const opening = "/goal is ordinary text before the Pi session exists";
  await composer.fill(opening);
  await composer.press("Enter");
  await expect(transcript.getByText(opening, { exact: true })).toBeVisible();
  await expect(transcript.getByText("Controller scoped Pi reply.")).toBeVisible({
    timeout: 60_000,
  });

  const embedded = "Please explain what /goal means without running it";
  await composer.fill(embedded);
  await composer.press("Enter");
  await expect(transcript.getByText(embedded, { exact: true })).toBeVisible();
  await expect(transcript.getByText("Controller scoped Pi reply.")).toHaveCount(2, {
    timeout: 60_000,
  });
});

test("Enter queues while the explicit control steers the active Pi turn", async ({ page }) => {
  const composer = await openControllerChat(page, "Queue and steer chat");
  await composer.fill("slow-response-marker");
  await composer.press("Enter");
  await expect(page.getByRole("button", { name: "Stop" })).toBeEnabled({ timeout: 60_000 });

  await composer.fill("queue-after-marker");
  await composer.press("Enter");
  const queue = page.getByTestId("queued-message-stack");
  await expect(queue.getByText("queue-after-marker", { exact: true })).toBeVisible();

  await composer.fill("interrupt-now-marker");
  await page.getByRole("button", { name: "Steer current task now" }).click();
  await expect(page.getByText("interrupt-now-marker", { exact: true })).toBeVisible();
  await expect(page.getByText("Steered response acknowledged.")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Queued response acknowledged.")).toBeVisible({ timeout: 60_000 });
  await expect(queue).toHaveCount(0);
});

test("Alt+Enter steers instead of queueing", async ({ page }) => {
  const composer = await openControllerChat(page, "Keyboard steer chat");
  await composer.fill("slow-response-marker");
  await composer.press("Enter");
  await expect(page.getByRole("button", { name: "Stop" })).toBeEnabled({ timeout: 60_000 });

  await composer.fill("interrupt-now-marker");
  await composer.press("Alt+Enter");
  await expect(page.getByText("interrupt-now-marker", { exact: true })).toBeVisible();
  await expect(page.getByText("Steered response acknowledged.")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("queued-message-stack")).toHaveCount(0);
});

test("mobile navigation and composer remain usable at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/agent");
  const menu = page.getByRole("button", { name: "Open navigation menu" });
  await menu.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByPlaceholder(/Do anything|Ask for follow-up changes/).first(),
  ).toBeVisible();
});

test("workspace notices stay below the toolbar and clear of the composer", async ({ page }) => {
  await page.route("**/api/agent/models", (route) => route.abort("connectionrefused"));
  await page.goto(`/agent?new=${encodeURIComponent("Notice layout")}`);

  const notice = page.locator("[data-workspace-notices]");
  const toolbar = page.getByRole("button", { name: "Session settings" }).first();
  const composer = page.locator(".agent-composer-box").first();

  await expect(notice).toBeVisible();
  await expect(toolbar).toBeVisible();
  await expect(composer).toBeVisible();

  const [noticeBox, toolbarBox, composerBox] = await Promise.all([
    notice.boundingBox(),
    toolbar.boundingBox(),
    composer.boundingBox(),
  ]);

  expect(noticeBox).not.toBeNull();
  expect(toolbarBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect(noticeBox!.y).toBeGreaterThanOrEqual(toolbarBox!.y + toolbarBox!.height);
  expect(noticeBox!.y + noticeBox!.height).toBeLessThanOrEqual(composerBox!.y);
});

test("pairing JSON is copyable from laptop and phone web layouts", async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/settings#profile");
  const copy = page.getByRole("button", { name: "Copy KittyLitter connection JSON" });
  await expect(copy).toBeEnabled();
  await copy.click();
  await expect(copy).toContainText("Copied");
  const desktopValue = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(desktopValue)).toEqual({
    v: 1,
    node_id: "test-node",
    token: "test-token",
    host_name: "test-host",
    relay: null,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(copy).toBeEnabled();
  await copy.click();
  await expect(copy).toContainText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(desktopValue);
});
