import { hashAnchor } from "../domain/route";

export {
	hashAnchor,
	isRoutePath,
	normalizePath,
	routePaths,
	type RoutePath,
} from "../domain/route";

type NavigationListener = () => void;

const navigationListeners = new Set<NavigationListener>();
const scrollStateKey = "__localStudioScroll";

export function saveScrollPosition() {
	window.history.replaceState(
		{ ...window.history.state, [scrollStateKey]: [window.scrollX, window.scrollY] },
		"",
	);
}

export function readScrollPosition() {
	// SAFETY: This history field is exclusively written by this module as an x/y tuple.
	const saved = window.history.state?.[scrollStateKey] as
		| readonly [number, number]
		| undefined;
	return saved ? { x: saved[0], y: saved[1] } : null;
}

export function pushNavigation(next: string) {
	saveScrollPosition();
	window.history.pushState({ [scrollStateKey]: [0, 0] }, "", next);
	emitNavigation();
}

export function subscribeToNavigation(listener: NavigationListener) {
	navigationListeners.add(listener);
	return () => {
		navigationListeners.delete(listener);
	};
}

export function emitNavigation() {
	for (const listener of navigationListeners) {
		listener();
	}
}

export function scrollToHash(hash: string) {
	const anchor = hashAnchor(hash);
	let target: Element | null;
	try {
		target = document.querySelector(anchor);
	} catch {
		return false;
	}
	if (!target) return false;
	target.scrollIntoView({ block: "start", behavior: "instant" });
	const heading = target.matches("h1, h2, h3")
		? target
		: target.querySelector("h1, h2, h3");
	const focusTarget =
		heading instanceof HTMLElement
			? heading
			: target instanceof HTMLElement
				? target
				: null;
	if (focusTarget === null) return true;
	if (!focusTarget.hasAttribute("tabindex")) {
		focusTarget.tabIndex = -1;
	}
	focusTarget.focus({ preventScroll: true });
	return true;
}
