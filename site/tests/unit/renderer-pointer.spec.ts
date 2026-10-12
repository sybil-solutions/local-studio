import { expect, test } from "@playwright/test";
import { mapPointerToLocalEnvironment } from "../../packages/logo-renderer/src/renderer/runtime/environment-input";

const rect = { left: 100, top: 200, width: 800, height: 400 };

function mapAt(normalizedX: number, normalizedY: number) {
	return mapPointerToLocalEnvironment({
		clientX: rect.left + rect.width * normalizedX,
		clientY: rect.top + rect.height * normalizedY,
		rect,
	});
}

test("renderer environment interaction follows its own bounds", () => {
	const localPoint = mapAt(0.61, 0.42);
	const translated = mapPointerToLocalEnvironment({
		clientX: rect.left + 500 + rect.width * 0.61,
		clientY: rect.top + 300 + rect.height * 0.42,
		rect: { ...rect, left: rect.left + 500, top: rect.top + 300 },
	});
	expect(translated).toEqual(localPoint);
	expect(mapAt(0.5, 0.5)).toEqual({
		envYaw: 0,
		envPitch: 0,
		normalizedX: 0,
		normalizedY: 0,
	});
});

test("a local vertical band scrubs one smooth orbital day path", () => {
	const above = mapAt(0.5, -0.25);
	const below = mapAt(0.5, 1.25);
	const farAbove = mapAt(0.5, -1);
	const farBelow = mapAt(0.5, 2);
	expect(above.normalizedY).toBe(-1);
	expect(below.normalizedY).toBe(1);
	expect(above.envYaw).toBeLessThan(-2);
	expect(below.envYaw).toBeGreaterThan(2);
	expect(above.envPitch).toBeLessThan(0);
	expect(below.envPitch).toBeGreaterThan(0);
	expect(farAbove).toEqual(above);
	expect(farBelow).toEqual(below);
});

test("horizontal movement cannot change the lighting cycle", () => {
	const left = mapAt(0, 0.65);
	const center = mapAt(0.5, 0.65);
	const right = mapAt(1, 0.65);
	expect(left.envYaw).toBe(center.envYaw);
	expect(right.envYaw).toBe(center.envYaw);
	expect(left.envPitch).toBe(center.envPitch);
	expect(right.envPitch).toBe(center.envPitch);
});

test("degenerate renderer bounds keep finite interaction values", () => {
	const mapped = mapPointerToLocalEnvironment({
		clientX: 2,
		clientY: -2,
		rect: { left: 0, top: 0, width: 0, height: 0 },
	});
	for (const value of Object.values(mapped)) expect(Number.isFinite(value)).toBe(true);
});
