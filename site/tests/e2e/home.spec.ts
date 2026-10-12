import { expect, test } from "@playwright/test";

test("Phone section keeps context visible while images and links stay fixed", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.goto("/");
	const cards = page.locator("[data-phone-feature]");
	await expect(cards).toHaveCount(4);
	await expect(cards.locator("[data-phone-feature-trigger]")).toHaveText([
		"Pair from Settings → Connections",
		"Follow a running turn",
		"Continue from anywhere",
		"Pick the model",
	]);
	await expect(page.locator("[data-phone-feature-description]")).toHaveCount(4);
	const images = cards.getByRole("region");
	const before = await images.evaluateAll((elements) =>
		elements.map((element) => element.getBoundingClientRect().top + window.scrollY),
	);
	await expect(cards.getByRole("link")).toHaveCount(0);
	await images.first().hover();
	await expect(cards.first()).toHaveAttribute("data-active", "true");
	await expect(
		cards.first().getByText("Pair the T3 Code mobile app", { exact: false }),
	).toBeVisible();
	await expect(cards.getByRole("link")).toHaveCount(0);
	const after = await images.evaluateAll((elements) =>
		elements.map((element) => element.getBoundingClientRect().top + window.scrollY),
	);
	expect(after).toEqual(before);
});

test("Phone carousel stays still without pagination chrome", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.goto("/");
	const carousel = page.getByRole("region", { name: "Phone features" });
	await carousel.scrollIntoViewIfNeeded();
	await expect(carousel.getByRole("status")).toHaveCount(0);
	expect(await carousel.evaluate((element) => element.scrollLeft)).toBe(0);
	await page.waitForTimeout(750);
	expect(await carousel.evaluate((element) => element.scrollLeft)).toBe(0);
	await carousel.evaluate((element) => {
		element.scrollLeft = element.scrollWidth;
	});
	await expect
		.poll(async () =>
			carousel.evaluate((element) => {
				const last = element.querySelector<HTMLElement>(
					"[data-phone-feature]:last-child",
				);
				const intro = document.querySelector<HTMLElement>("[data-phone-intro]");
				if (!last || !intro) return Number.NaN;
				return Math.round(
					intro.getBoundingClientRect().right -
						last.getBoundingClientRect().right,
				);
			}),
		)
		.toBe(0);
	await expect(page.locator("[data-phone-feature-description]")).toHaveCount(4);
});


test("Phone carousel supports image jumps and pointer dragging", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.goto("/");
	const carousel = page.getByRole("region", { name: "Phone features" });
	await carousel.scrollIntoViewIfNeeded();
	await page
		.locator("[data-phone-feature]")
		.nth(1)
		.getByRole("region")
		.click();
	await expect
		.poll(() => carousel.evaluate((element) => element.scrollLeft))
		.toBeGreaterThan(0);
	await expect
		.poll(() =>
			carousel.evaluate((element) => {
				const card = element.querySelectorAll<HTMLElement>("[data-phone-feature]")[1];
				if (!card) return Number.POSITIVE_INFINITY;
				const carouselBounds = element.getBoundingClientRect();
				const cardBounds = card.getBoundingClientRect();
				return Math.abs(
					cardBounds.left + cardBounds.width / 2 -
						(carouselBounds.left + carouselBounds.width / 2),
				);
			}),
		)
		.toBeLessThanOrEqual(2);
	await page.waitForTimeout(500);
	await carousel.evaluate((element) => {
		element.scrollLeft = 0;
	});
	await expect.poll(() => carousel.evaluate((element) => element.scrollLeft)).toBe(0);
	await page.waitForTimeout(500);
	const dragMetrics = await carousel.evaluate((element) => {
		const card = element.querySelector<HTMLElement>("[data-phone-feature]");
		const grid = element.querySelector<HTMLElement>("[data-phone-items]");
		if (!card || !grid) throw new Error("carousel metrics");
		const gap = Number.parseFloat(getComputedStyle(grid).columnGap) || 0;
		return {
			before: element.scrollLeft,
			stride: card.getBoundingClientRect().width + gap,
		};
	});
	const box = await carousel.boundingBox();
	if (!box) throw new Error("carousel geometry");
	const startX = box.x + box.width * 0.55;
	const y = box.y + box.height * 0.4;
	await page.mouse.move(startX, y);
	await page.mouse.down();
	await page.mouse.move(startX - 48, y, { steps: 4 });
	await page.mouse.up();
	await expect
		.poll(() => carousel.evaluate((element) => element.scrollLeft))
		.toBeGreaterThan(dragMetrics.before + dragMetrics.stride * 0.8);
	await page.waitForTimeout(600);
	const settled = await carousel.evaluate((element) => element.scrollLeft);
	await page.waitForTimeout(300);
	expect(
		Math.abs(
			(await carousel.evaluate((element) => element.scrollLeft)) - settled,
		),
	).toBeLessThan(2);

	await carousel.evaluate((element) => {
		element.scrollLeft = element.scrollWidth;
	});
	await expect(carousel).toHaveAttribute("data-carousel-index", "3");
	const endScroll = await carousel.evaluate((element) => element.scrollLeft);
	const lastTrigger = page
		.locator("[data-phone-feature]")
		.last()
		.locator("[data-phone-feature-trigger]");
	const triggerBox = await lastTrigger.boundingBox();
	if (!triggerBox) throw new Error("carousel trigger geometry");
	const triggerX = triggerBox.x + triggerBox.width / 2;
	const triggerY = triggerBox.y + triggerBox.height / 2;
	await page.mouse.move(triggerX, triggerY);
	await page.mouse.down();
	await page.mouse.move(triggerX + 48, triggerY, { steps: 4 });
	await page.mouse.up();
	await expect
		.poll(() => carousel.evaluate((element) => element.scrollLeft))
		.toBeLessThan(endScroll - 100);
	await page.waitForTimeout(600);
	const reversed = await carousel.evaluate((element) => element.scrollLeft);
	await page.waitForTimeout(300);
	expect(
		Math.abs(
			(await carousel.evaluate((element) => element.scrollLeft)) - reversed,
		),
	).toBeLessThan(2);
});

test("homepage stays inside the viewport at 320", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 640 });
	await page.goto("/");
	const overflow = await page.evaluate(
		() =>
			document.documentElement.scrollWidth -
			document.documentElement.clientWidth,
	);
	expect(overflow).toBeLessThanOrEqual(0);
});

test("full hero entrance animates copy and render surface", async ({ page, request }) => {
	const html = await (await request.get("/")).text();
	const stage = html.match(/<div[^>]*id="product"[^>]*>/)?.[0] ?? "";
	const title = html.match(/<div[^>]*>(?=<h1 id="landing-title")/)?.[0] ?? "";
	expect(stage).toContain('id="product"');
	expect(stage).toContain("opacity:0");
	expect(title).toContain("opacity:0");
	await page.goto("/");
	await expect(page.locator("#landing-title")).toHaveCSS("opacity", "1");
	await expect(page.locator("#product")).toHaveCSS("opacity", "1");
});
