import { expect, test } from "@playwright/test";
import { routes, routePaths } from "../../src/domain/route";

const pages = routePaths;

test("/mobile redirects to the homepage mobile section", async ({ page }) => {
  await page.goto("/mobile");
  await expect(page).toHaveURL(/\/#mobile$/);
});

test("/agents redirects to setup", async ({ page }) => {
  await page.goto("/agents");
  await expect(page).toHaveURL(/\/setup$/);
});

for (const path of pages) {
  test(`${path} loads`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(path);
    await expect(page).toHaveTitle(routes[path].title);
    await expect(
      page.getByRole("heading", { level: 1, name: routes[path].heading }),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
}

test("client navigation renders routes immediately", async ({ page }) => {
  const targets = ["/overview", "/machine", "/docs", "/setup", "/download"] as const;
  for (const target of targets) {
    await page.goto("/");
    await page.evaluate(() => {
      const root = document.querySelector("#root");
      if (!root) return;
      root.setAttribute("data-main-dropped", "false");
      new MutationObserver(() => {
        if (!root.querySelector("main")) root.setAttribute("data-main-dropped", "true");
      }).observe(root, { childList: true, subtree: true });
    });
    await page
      .locator(`a[href="${target}"]`)
      .first()
      .evaluate((link: HTMLAnchorElement) => link.click());
    await expect(page).toHaveURL(new RegExp(`${target}$`));
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: routes[target].heading,
      }),
    ).toBeVisible();
    await expect(page.locator("#root")).toHaveAttribute("data-main-dropped", "false");
  }
});

test("primary information routes need no late JavaScript", async ({ page }) => {
  const targets = ["/setup", "/docs", "/overview"] as const;
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: routes["/"].heading }),
  ).toBeVisible();
  await page.route(/\/assets\/.*\.js$/, (route) => route.abort());
  for (const target of targets) {
    await page
      .locator(`a[href="${target}"]`)
      .first()
      .evaluate((link: HTMLAnchorElement) => link.click());
    await expect(page).toHaveURL(new RegExp(`${target}$`));
    await expect(
      page.getByRole("heading", { level: 1, name: routes[target].heading }),
    ).toBeVisible();
  }
});

test("unknown routes render not-found", async ({ page }) => {
  await page.goto("/does-not-exist");
  await expect(page).toHaveTitle("Page not found - Local Studio");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
