import { expect, test } from "@playwright/test";
import { installProductFixtures } from "./product-fixtures";

test("a user can inspect usage, configure the workstation, and open the workbench", async ({
  page,
}) => {
  await installProductFixtures(page);

  await test.step("Inspect complete agent token activity", async () => {
    await page.goto("/usage");
    await expect(page.getByRole("heading", { name: "Usage" })).toBeVisible();
    await expect(page.getByText("1.50B", { exact: true })).toBeVisible();
    await expect(page.getByText("18.4K", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Token activity" })).toBeVisible();
  });

  await test.step("Hover a daily cell and read its exact activity", async () => {
    const activeDay = page.getByRole("button", { name: /95\.68M tokens, 1\.2K requests/ });
    await activeDay.hover();
    await expect(page.getByText(/95\.68M tokens · 1\.2K requests/)).toBeVisible();
  });

  await test.step("Switch to proxied controller usage", async () => {
    await page.getByRole("tab", { name: "Proxy", exact: true }).click();
    await expect(page.getByText("450.00M", { exact: true })).toBeVisible();
    await expect(page.getByText("Requests proxied through this controller")).toBeVisible();
  });

  await test.step("Open Configure and move through its real sections", async () => {
    await page.getByTitle("Configure").click();
    await expect(page).toHaveURL(/\/configure/);
    await expect(page.getByRole("heading", { name: "Configure", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Configuration", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Machines", exact: true }).first().click();
    await expect(page).toHaveURL(/#rig$/);
    await expect(page.getByRole("heading", { name: "Machines", exact: true })).toBeVisible();
    await expect(page.getByText("Mac Studio", { exact: true })).toBeVisible();
  });

  await test.step("Change appearance from Settings", async () => {
    await page.getByTitle("Settings").click();
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Appearance", exact: true })).toBeVisible();
    await expect(page.getByText("Theme", { exact: true }).first()).toBeVisible();
  });

  await test.step("Open the coding workbench", async () => {
    await page.getByTitle("Workbench").click();
    await expect(page).toHaveURL(/\/agent/);
    await expect(page.getByText("Add a project to get started", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add a project", exact: true })).toBeVisible();
  });
});
