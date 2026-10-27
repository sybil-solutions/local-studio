import { expect, test } from "@playwright/test";

test("1", async ({ page }) => {
	for (const scheme of ["dark", "light"] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		await page.goto("/");
		const audit = await page.evaluate(() => ({
			colorScheme: getComputedStyle(document.documentElement).colorScheme,
			themeColor: [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')]
				.find((meta) => matchMedia(meta.media).matches)?.content,
		}));
		expect(audit).toEqual({
			colorScheme: scheme,
			themeColor: scheme === "dark" ? "#000000" : "#ffffff",
		});
	}
});

test("2", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "dark" });
	await page.goto("/");
	const primary = page.locator("main").getByRole("link", { name: /Download Local Studio/ }).first();
	const primaryStyle = await primary.evaluate((element) => {
		const style = getComputedStyle(element);
		return { borderColor: style.borderColor, boxShadow: style.boxShadow };
	});
	expect(primaryStyle.boxShadow.match(/rgba?\(|color\(/g)?.length).toBeGreaterThanOrEqual(2);
	const borderChannels = primaryStyle.borderColor.match(/[\d.]+/g)?.map(Number) ?? [];
	expect(borderChannels[2]).toBeGreaterThanOrEqual(borderChannels[0] ?? 0);

	await page.goto("/product");
	const frame = page.locator("figure").filter({ has: page.locator("img") }).first();
	const radii = await frame.evaluate((element) => {
		const image = element.querySelector("img");
		return {
			inner: image ? Number.parseFloat(getComputedStyle(image).borderTopLeftRadius) : 0,
			outer: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius),
			padding: Number.parseFloat(getComputedStyle(element).paddingTop),
		};
	});
	expect(radii.inner).toBeLessThanOrEqual(radii.outer);
	expect(Math.abs(radii.outer - radii.inner - radii.padding)).toBeLessThanOrEqual(1);

	await page.goto("/setup");
	const prompt = page.getByRole("region", { name: "Portable setup prompt" });
	const fade = await prompt.evaluate((element) => ({
		backgroundImage: getComputedStyle(element, "::after").backgroundImage,
		maskImage: getComputedStyle(element.querySelector("pre")!).maskImage,
	}));
	expect(fade.backgroundImage).not.toBe("none");
	expect(fade.maskImage).toBe("none");
});

test("3", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "dark" });
	await page.goto("/");
	const brightness = (color: string) =>
		(color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? []).reduce((sum, value) => sum + value, 0);
	const heading = await page.getByRole("heading", { level: 1 }).evaluate((element) => getComputedStyle(element).color);
	for (const control of [page.getByRole("button", { name: "Products" }), page.locator("footer a").first()]) {
		await control.scrollIntoViewIfNeeded();
		const rest = await control.evaluate((element) => getComputedStyle(element).color);
		await control.hover();
		await page.waitForTimeout(150);
		const hover = await control.evaluate((element) => getComputedStyle(element).color);
		expect(brightness(rest)).toBeLessThan(brightness(heading));
		expect(brightness(hover)).toBeGreaterThan(brightness(rest));
	}
});

test("4", async ({ page }) => {
	await page.goto("/#mobile");
	const card = page.locator("[data-phone-feature]").first();
	const media = card.getByRole("region");
	const image = card.locator("img");
	const treatment = await media.evaluate((element) => ({
		boxShadow: getComputedStyle(element).boxShadow,
		filter: getComputedStyle(element.querySelector("img")!).filter,
	}));
	expect(treatment.boxShadow).toBe("none");
	expect(treatment.filter).not.toContain("grayscale");
	await expect(image).toBeVisible();
});
