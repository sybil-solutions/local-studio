import { expect, test } from "@playwright/test";

test.describe("desktop shell", () => {
  test("keeps the shared navigation and app surface usable", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("navigation")).toBeVisible();
    await expect(page.getByRole("link", { name: /status/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /usage/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /models/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /server/i })).toBeVisible();

    await page.getByRole("button", { name: /collapse sidebar/i }).click();
    await expect(page.getByRole("button", { name: /expand sidebar/i })).toBeVisible();
    await page.getByRole("button", { name: /expand sidebar/i }).click();
    await expect(page.getByRole("button", { name: /collapse sidebar/i })).toBeVisible();
  });
});

test.describe("agent composer", () => {
  test("renders an empty composer without placeholder text", async ({ page }) => {
    await page.goto("/agent");

    const composer = page.locator("textarea, [contenteditable='true']").first();
    await expect(composer).toBeVisible();
    await expect(page.getByText(/message deepseek|message gemma|message .*rtx/i)).toHaveCount(0);
  });
});
