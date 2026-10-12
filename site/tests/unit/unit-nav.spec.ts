import { expect, test } from "@playwright/test";
import {
	closedNav,
	desktopMenu,
	isMobileOpen,
	reduceNav,
} from "../../src/domain/nav";

test("desktop and mobile menus cannot be open together", () => {
	const desktop = reduceNav(closedNav, { type: "openDesktop", menu: "products" });
	expect(desktopMenu(desktop)).toBe("products");
	expect(isMobileOpen(desktop)).toBe(false);
	const mobile = reduceNav(desktop, { type: "openMobile" });
	expect(desktopMenu(mobile)).toBeNull();
	expect(isMobileOpen(mobile)).toBe(true);
	const closed = reduceNav(mobile, { type: "close" });
	expect(closed).toEqual(closedNav);
});

test("viewport changes close the incompatible surface", () => {
	const desktop = reduceNav(closedNav, { type: "openDesktop", menu: "resources" });
	expect(reduceNav(desktop, { type: "viewportMobile" })).toEqual(closedNav);
	const mobile = reduceNav(closedNav, { type: "openMobile" });
	expect(reduceNav(mobile, { type: "viewportDesktop" })).toEqual(closedNav);
	expect(reduceNav(mobile, { type: "toggleMobile" })).toEqual(closedNav);
});
