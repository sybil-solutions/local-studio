import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const bannedReactEffectHookNames = [
  "use" + "Effect",
  "useLayout" + "Effect",
  "useInsertion" + "Effect",
];

const bannedReactEffectCallSelector = bannedReactEffectHookNames
  .map(
    (name) =>
      `CallExpression[callee.name='${name}'], CallExpression[callee.property.name='${name}']`,
  )
  .join(", ");

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      complexity: ["warn", { max: 20 }],
      "max-depth": ["warn", 4],
      "max-params": ["warn", 5],
      "no-duplicate-imports": "warn",
      "no-restricted-syntax": [
        "error",
        {
          selector: bannedReactEffectCallSelector,
          message:
            "React effect hooks are banned. Use event handlers, external stores, or dedicated subscriptions instead.",
        },
      ],
      "@typescript-eslint/naming-convention": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@next/next/no-img-element": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/static-components": "off",
      "react-hooks/purity": "off",
      "react-hooks/immutability": "off",
    },
  },
  {
    files: ["src/lib/**/*.ts", "src/lib/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/app/*"],
              message:
                "src/lib is a lower-level seam and must not import app/UI modules. Move shared types or helpers into src/lib first.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "desktop/dist/**",
    "dist-desktop/**",
  ]),
]);

export default eslintConfig;
