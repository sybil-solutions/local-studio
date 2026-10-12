import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { assets } from "../../src/domain/asset";

function publicPath(file: { path: string }) {
	return `/${file.path.replace(/^public\//, "")}`;
}

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return [path];
	});
}

test("every registered asset exists in the public asset manifest", () => {
	const manifest = JSON.parse(readFileSync("asset-manifest.json", "utf8"));
	const publicPaths = new Set(manifest.files.map(publicPath));
	for (const path of Object.values(assets)) {
		expect(publicPaths.has(path), path).toBe(true);
	}
});

test("every inventoried public file is registered in the asset model", () => {
	const manifest = JSON.parse(readFileSync("asset-manifest.json", "utf8"));
	const registered = new Set(Object.values(assets));
	for (const file of manifest.files) {
		const path = publicPath(file);
		expect(registered.has(path), path).toBe(true);
	}
});


test("asset manifest records media types and image dimensions", () => {
	const manifest = JSON.parse(readFileSync("asset-manifest.json", "utf8"));
	for (const file of manifest.files) {
		expect(file.type, file.path).toEqual(expect.any(String));
		if (file.role === "image" || file.role === "icon" || file.role === "sponsor") {
			expect(file.dimensions, file.path).toEqual({
				width: expect.any(Number),
				height: expect.any(Number),
			});
		} else {
			expect(file.dimensions, file.path).toBeNull();
		}
	}
});


test("source public asset references belong to the asset registry", () => {
	const registered = new Set(Object.values(assets));
	const references = /["'(]((?:\/images|\/fonts|\/localai)\/[^"'\s)]+)/g;
	const violations: string[] = [];
	for (const root of ["src", "packages"]) {
		for (const path of sourceFiles(root)) {
			if (!/[.]([cm]?[jt]sx?|css|mjs)$/.test(path)) continue;
			const source = readFileSync(path, "utf8");
			for (const match of source.matchAll(references)) {
				if (!registered.has(match[1])) violations.push(`${path}: ${match[1]}`);
			}
		}
	}
	expect(violations).toEqual([]);
});
