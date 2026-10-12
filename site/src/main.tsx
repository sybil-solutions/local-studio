import * as stylex from "@stylexjs/stylex";
import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./app/App";
import { assets, heroSizes, responsiveSrcSet } from "./domain/asset";
import { isHeroImageRoute } from "./domain/route";
import "./styles/stylex-entry.css";
import { baseStyles } from "./styles/base-styles";
import { constants } from "./styles/public-tokens.stylex";



const fontFaces = [
	new FontFace(constants.fontSansName, 'url("/fonts/geist-sans.woff2") format("woff2")', { style: "normal", weight: "100 900", display: "swap" }),
	new FontFace(constants.fontMonoName, 'url("/fonts/geist-mono.woff2") format("woff2")', { style: "normal", weight: "100 900", display: "swap" }),
];
for (const face of fontFaces) {
	document.fonts.add(face);
	void face.load();
}
document.documentElement.className =
	stylex.props(
		baseStyles.element,
		baseStyles.html,
	).className ?? "";
document.body.className =
	stylex.props(
		baseStyles.element,
		baseStyles.body,
	).className ?? "";

function setFavicon(href: string, media: string) {
	const link = document.createElement("link");
	link.rel = "icon";
	link.type = "image/svg+xml";
	link.href = href;
	link.media = media;
	document.head.append(link);
}

setFavicon(assets.favicon, "(prefers-color-scheme: light)");
setFavicon(assets.faviconDark, "(prefers-color-scheme: dark)");

function syncKeyboardMode(event: Event) {
	if (event.type === "keydown") {
		document.documentElement.dataset["keyboard"] = "true";
	} else {
		delete document.documentElement.dataset["keyboard"];
	}
}

function isSiteImage(target: EventTarget | null) {
	return target instanceof Element && target.closest("img, picture") !== null;
}

function preventImageAction(event: Event) {
	if (isSiteImage(event.target)) {
		event.preventDefault();
	}
}

document.addEventListener("keydown", syncKeyboardMode);
document.addEventListener("pointerdown", syncKeyboardMode);
document.addEventListener("contextmenu", preventImageAction);
document.addEventListener("dragstart", preventImageAction);
document.addEventListener("selectstart", preventImageAction);

if (isHeroImageRoute(window.location.pathname)) {
	const preload = document.createElement("link");
	preload.rel = "preload";
	preload.as = "image";
	preload.setAttribute("fetchpriority", "high");
	preload.href = assets.shotThread1300;
	preload.setAttribute(
		"imagesrcset",
		responsiveSrcSet(assets.shotThread),
	);
	preload.setAttribute("imagesizes", heroSizes);
	document.head.append(preload);
}

const root = document.getElementById("root");
if (root === null) {
	throw new Error("root");
}
root.className =
	stylex.props(
		baseStyles.element,
		baseStyles.root,
	).className ?? "";
const app = (
	<StrictMode>
		<App />
	</StrictMode>
);
if (window.location.pathname === "/" && root.hasChildNodes()) {
	hydrateRoot(root, app);
} else {
	root.replaceChildren();
	createRoot(root).render(app);
}
