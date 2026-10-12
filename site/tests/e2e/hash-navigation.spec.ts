import { expect, test } from "@playwright/test";

test("malformed URL hashes do not raise browser errors", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));

	await page.goto("/#%5B");
	await expect(
		page.getByRole("heading", { level: 1, name: /Intelligence Should Be Owned/ }),
	).toBeVisible();
	await page.waitForTimeout(50);

	expect(errors).toEqual([]);
});
