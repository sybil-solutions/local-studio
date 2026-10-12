import { expect, test } from "@playwright/test";

test("header uses the standard LocalAI mark", async ({ page }) => {
	await page.goto("/");
	const logo = page
		.getByRole("banner")
		.getByRole("link", { name: "Local Studio", exact: true })
		.locator('img[src="/images/localai_light.svg"]');
	await expect(logo).toBeVisible();
	const response = await page.request.get("/images/localai_light.svg");
	expect(response.ok()).toBeTruthy();
	expect(response.headers()["content-type"]).toContain("image/svg+xml");
	const source = await response.text();
	expect(source).toContain('viewBox="0 0 525 525"');
});

test("hero uses the local standalone mark", async ({ page }) => {
	await page.goto("/");
	const mark = page
		.getByRole("link", { name: "Machine-readable page" })
		.locator('img[src="/images/optimized.svg"]');
	await expect(mark).toBeVisible();
	const response = await page.request.get("/images/optimized.svg");
	expect(response.ok()).toBeTruthy();
	expect(response.headers()["content-type"]).toContain("image/svg+xml");
	const source = await response.text();
	expect(source).toContain('viewBox="0 0 525 525"');
});

test("footer no longer renders the outline mark", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByRole("contentinfo").locator("img")).toHaveCount(0);
	await expect(page.locator('footer img[src="/images/optimized-outline.svg"]')).toHaveCount(0);
});

test("document uses transparent light and dark favicon assets", async ({ page }) => {
	await page.goto("/");
	const lightFavicon = page.locator(
		'link[rel="icon"][media="(prefers-color-scheme: light)"]',
	);
	const darkFavicon = page.locator(
		'link[rel="icon"][media="(prefers-color-scheme: dark)"]',
	);
	await expect(lightFavicon).toHaveAttribute("href", "/images/favicon.svg");
	await expect(darkFavicon).toHaveAttribute(
		"href",
		"/images/favicon-dark.svg",
	);
	for (const path of ["/images/favicon.svg", "/images/favicon-dark.svg"]) {
		const response = await page.request.get(path);
		expect(response.ok()).toBeTruthy();
		expect(response.headers()["content-type"]).toContain("image/svg+xml");
		expect(await response.text()).toContain('fill-rule="evenodd"');
	}
});

test("navbar uses compact text and an accessible GitHub icon", async ({ page }) => {
	await page.goto("/");
	const mobile = page.getByRole("navigation", { name: "Landing navigation" }).getByRole("link", { name: "Company" });
	const typography = await mobile.evaluate(element => {
		const style = getComputedStyle(element);
		return [style.fontSize, style.lineHeight];
	});
	expect(typography).toEqual(["16px", "24px"]);
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
	await page.getByRole("button", { name: "Open menu" }).click();
	const github = page.getByRole("dialog", { name: "Navigation menu" }).getByRole("link", { name: "GitHub" });
	await expect(github).toHaveAttribute("href", "https://github.com/sybil-solutions/local-studio");
	await expect(github.locator("svg")).toBeVisible();
});

test("site images cannot be copied, dragged, or saved", async ({ page }) => {
	for (const route of ["/", "/product"]) {
		await page.goto(route, { waitUntil: "networkidle" });
		await page.locator("img").first().waitFor();
		const result = await page.evaluate(() => {
			const images = [...document.images];
			if (images.length === 0) throw new Error("img");
			const heading = document.querySelector("h1");
			if (!(heading instanceof HTMLElement)) throw new Error("h1");
			const textMenu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
			heading.dispatchEvent(textMenu);
			return {
				textMenu: textMenu.defaultPrevented,
				images: images.map((image) => {
					const style = getComputedStyle(image);
					const context = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
					const drag = new Event("dragstart", { bubbles: true, cancelable: true });
					const select = new Event("selectstart", { bubbles: true, cancelable: true });
					image.dispatchEvent(context);
					image.dispatchEvent(drag);
					image.dispatchEvent(select);
					return {
						userSelect: style.userSelect,
						drag: style.getPropertyValue("-webkit-user-drag"),
						context: context.defaultPrevented,
						dragStart: drag.defaultPrevented,
						selectStart: select.defaultPrevented,
					};
				}),
			};
		});
		expect(result.textMenu).toBe(false);
		for (const image of result.images) {
			expect(image).toEqual({
				userSelect: "none",
				drag: "none",
				context: true,
				dragStart: true,
				selectStart: true,
			});
		}
	}
});
