import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { expect, test } from "@playwright/test";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const TOKEN_OWNERS = new Set(["src/styles/public-tokens.stylex.ts"]);

function sourceFiles(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return SOURCE_EXTENSIONS.has(extname(path)) ? [path] : [];
	});
}

test("page colors use typed StyleX tokens instead of loose literals", () => {
	const violations = sourceFiles("src").flatMap((path) => {
		const projectPath = relative(".", path);
		if (TOKEN_OWNERS.has(projectPath)) return [];
		const source = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
		return source.split("\n").flatMap((line, index) => {
			const code = line.replace(/\/\/.*$/, "");
			const colors = [
				...(code.match(/(?<!&)#[\da-f]{3,8}\b/gi) ?? []),
				...(code.match(/\b(?:rgb|rgba|hsl|hsla)\([^)]*\)/gi) ?? []),
			];
			return colors.map(
				(color) => `${projectPath}:${index + 1} ${color}`,
			);
		});
	});
	const tokenOwner = readFileSync("src/styles/public-tokens.stylex.ts", "utf8");
	expect(tokenOwner).toMatch(/stylex\.defineVars\(/);
	expect(tokenOwner).toMatch(/stylex\.types\.color\(/);

	expect(violations).toEqual([]);
});
