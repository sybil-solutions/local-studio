import { expect, test } from "@playwright/test";
import { routePaths } from "../../src/domain/route";

test("every HTML route has one main landmark and a skip link", async ({ page }) => {
	for (const path of routePaths) {
		await page.goto(path);
		await expect(page.locator("main#content")).toHaveCount(1);
		await expect(page.locator("main")).toHaveCount(1);
	}
	const skip = page.getByRole("link", { name: "Skip to content" });
	await expect(skip).toHaveAttribute("href", "#content");
});

test("product names are protected from translation", async ({ page }) => {
	await page.goto("/");
	await expect(page.locator('[translate="no"]').first()).toBeVisible();
});

test("every HTML route has exactly one h1", async ({ page }) => {
	for (const path of routePaths) {
		await page.goto(path);
		await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
	}
});
