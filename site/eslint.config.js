import eslint from "@eslint/js";
import stylexEslint from "@stylexjs/eslint-plugin";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default defineConfig([
	globalIgnores(["dist", "tools/oxlint/anti-slop"]),
	{
		files: ["**/*.{ts,tsx}"],
		extends: [
			eslint.configs.recommended,
			...tseslint.configs.recommended,
			reactHooks.configs.flat.recommended,
			reactRefresh.configs.vite,
		],
		languageOptions: {
			ecmaVersion: 2023,
			globals: globals.browser,
		},
		plugins: {
			"@stylexjs": stylexEslint,
		},
		rules: {
			"@stylexjs/enforce-extension": "error",
			"@stylexjs/no-legacy-contextual-styles": "error",
			"@stylexjs/no-nonstandard-styles": "error",
			"@stylexjs/no-unused": "error",
			"@stylexjs/valid-shorthands": "error",
			"@stylexjs/valid-styles": "error",
		},
	},
	{
		files: [
			"src/sections/localai-logo-shader/render/shaders.ts",
			"src/sections/localai-logo-shader/render/cubemap.ts",
		],
		rules: { "@typescript-eslint/triple-slash-reference": "off" },
	},
]);
