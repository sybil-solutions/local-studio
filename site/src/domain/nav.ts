export type MenuId = "products" | "resources";

export type NavSurface =
	| { readonly kind: "closed" }
	| { readonly kind: "desktop"; readonly menu: MenuId }
	| { readonly kind: "mobile" };

export const closedNav = { kind: "closed" } as const satisfies NavSurface;

type NavEvent =
	| { readonly type: "openDesktop"; readonly menu: MenuId }
	| { readonly type: "closeDesktop" }
	| { readonly type: "openMobile" }
	| { readonly type: "closeMobile" }
	| { readonly type: "toggleMobile" }
	| { readonly type: "viewportMobile" }
	| { readonly type: "viewportDesktop" }
	| { readonly type: "close" };

export function reduceNav(state: NavSurface, event: NavEvent): NavSurface {
	switch (event.type) {
		case "openDesktop":
			return { kind: "desktop", menu: event.menu };
		case "closeDesktop":
			return state.kind === "desktop" ? closedNav : state;
		case "openMobile":
			return { kind: "mobile" };
		case "closeMobile":
			return state.kind === "mobile" ? closedNav : state;
		case "toggleMobile":
			return state.kind === "mobile" ? closedNav : { kind: "mobile" };
		case "viewportMobile":
			return state.kind === "desktop" ? closedNav : state;
		case "viewportDesktop":
			return state.kind === "mobile" ? closedNav : state;
		case "close":
			return closedNav;
	}
}

export function desktopMenu(state: NavSurface): MenuId | null {
	return state.kind === "desktop" ? state.menu : null;
}

export function isMobileOpen(state: NavSurface): boolean {
	return state.kind === "mobile";
}
