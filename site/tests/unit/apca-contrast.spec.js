import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const source = readFileSync("src/styles/public-tokens.stylex.ts", "utf8");

function tokenHex(name, scheme) {
	const match = source.match(new RegExp(
		`${name}: stylex\\.types\\.color\\(\\{ default: "(#[0-9a-f]{6})", \\[lightScheme\\]: "(#[0-9a-f]{6})"`,
	));
	const color = match?.[scheme === "light" ? 2 : 1];
	if (!color) throw new Error("token");
	return color;
}

function luminance(hex) {
	const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
	const value = channels[0] ** 2.4 * 0.2126729 + channels[1] ** 2.4 * 0.7151522 + channels[2] ** 2.4 * 0.072175;
	return value < 0.022 ? value + (0.022 - value) ** 1.414 : value;
}

function apcaContrast(text, background) {
	const textY = luminance(text);
	const backgroundY = luminance(background);
	if (Math.abs(backgroundY - textY) < 0.0005) return 0;
	if (backgroundY > textY) {
		const contrast = (backgroundY ** 0.56 - textY ** 0.57) * 1.14;
		return contrast < 0.1 ? 0 : (contrast - 0.027) * 100;
	}
	const contrast = (backgroundY ** 0.65 - textY ** 0.62) * 1.14;
	return contrast > -0.1 ? 0 : (contrast + 0.027) * 100;
}

const roles = { foreground: 100, fine: 90, dim: 75, quiet: 65, chrome: 50 };
const stops = ["selectionSkyBright", "selectionSkyDay", "selectionSkyBlue", "selectionSkyDusk", "selectionSkyNight"];

test("APCA roles", () => {
	for (const scheme of ["dark", "light"]) {
		const background = tokenHex("background", scheme);
		for (const [name, minimum] of Object.entries(roles)) {
			expect(Math.abs(apcaContrast(tokenHex(name, scheme), background))).toBeGreaterThanOrEqual(minimum);
		}
		const ink = tokenHex("selectionInk", scheme);
		const palette = stops.map((name) => tokenHex(name, scheme));
		for (let index = 1; index < palette.length; index += 1) {
			expect(luminance(palette[index - 1])).toBeGreaterThan(luminance(palette[index]));
		}
		for (const color of palette) {
			expect(Math.abs(apcaContrast(ink, color))).toBeGreaterThanOrEqual(75);
		}
	}

	const light = readFileSync("packages/logo-renderer/src/renderer/shaders/postprocess/light-composite.wgsl", "utf8");
	const dark = readFileSync("packages/logo-renderer/src/renderer/shaders/bloom/composite.wgsl", "utf8");
	const lightFloor = Number(light.match(/mix\(sky, vec3f\(1\.0\), ([\d.]+)\)/)?.[1]);
	const darkCap = Number(dark.match(/MAX_DARK_DISPLAY_LUMA = ([\d.]+)/)?.[1]);
	for (const [scheme, channel] of [["light", lightFloor], ["dark", darkCap]]) {
		const hex = `#${Math.round(255 * channel).toString(16).padStart(2, "0").repeat(3)}`;
		expect(Math.abs(apcaContrast(tokenHex("foreground", scheme), hex))).toBeGreaterThanOrEqual(75);
	}
});
