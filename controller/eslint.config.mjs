import unicorn from "eslint-plugin-unicorn";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

/** @type {import("eslint").Linter.FlatConfig[]} */
const config = [
  {
    ignores: ["bun.lockb", "dist", "node_modules", "runtime", "knip.ts"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        sourceType: "module",
        ecmaVersion: "latest",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      unicorn,
    },
    rules: {
      "no-throw-literal": "error",
      "no-console": "off",
      "prefer-const": "error",
      eqeqeq: ["error", "always"],
      "max-lines-per-function": ["error", { max: 500, skipBlankLines: true, skipComments: true }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/explicit-function-return-type": "error",
      "@typescript-eslint/no-inferrable-types": "off",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "unicorn/consistent-function-scoping": "off",
      "unicorn/no-null": "off",
      "unicorn/prevent-abbreviations": [
        "error",
        {
          allowList: {
            env: true,
            db: true,
            ctx: true,
            req: true,
            res: true,
            id: true,
            ids: true,
            args: true,
            params: true,
            dir: true,
            dirs: true,
            docs: true,
            Docs: true,
            moduleDir: true,
          },
        },
      ],
    },
  },
];

export default config;
