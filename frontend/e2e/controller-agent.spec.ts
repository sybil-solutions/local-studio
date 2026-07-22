import { expect, test } from "@playwright/test";

test("Pi defaults to the active controller and reveals other models on request", async ({
  page,
}) => {
  await page.goto(`/agent?new=${encodeURIComponent("Controller scoped chat")}`);
  const picker = page.getByRole("button", { name: /^Model:/ }).first();
  await expect(picker).toBeEnabled({ timeout: 60_000 });
  await expect(picker).toHaveAccessibleName(/controller-model/);
  await expect(page.getByRole("button", { name: "Pi tools: read only" })).toBeVisible();
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
