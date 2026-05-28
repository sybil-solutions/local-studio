import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import boundaries from "eslint-plugin-boundaries";

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
    plugins: {
      boundaries,
    },
    settings: {
      "boundaries/elements": [
        { type: "app", pattern: "src/app/**" },
        { type: "components", pattern: "src/components/**" },
        { type: "hooks", pattern: "src/hooks/**" },
        { type: "lib", pattern: "src/lib/**" },
        { type: "store", pattern: "src/store/**" },
      ],
    },
    rules: {
      complexity: ["warn", { max: 20 }],
      "max-depth": ["warn", 4],
      "max-params": ["warn", 5],
      "max-lines-per-function": ["error", { max: 500, skipBlankLines: true, skipComments: true }],
      "no-duplicate-imports": "warn",
      "max-lines": ["error", { max: 500, skipBlankLines: true, skipComments: true }],
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
      "boundaries/element-types": [
        "warn",
        {
          default: "allow",
          rules: [
            {
              from: ["app"],
              disallow: ["app"],
            },
          ],
        },
      ],
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
  // Tests, configs and types files are exempt from the file-length cap.
  {
    files: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "src/lib/themes.ts",
      "**/*.d.ts",
    ],
    rules: {
      "max-lines": "off",
    },
  },
  // Legacy files that already exceed the limits. New code must obey the rules;
  // these are tracked offenders to be refactored. Remove an entry once the file
  // is under 500 LOC and no longer needs a legacy allowance.
  {
    files: [
      "src/app/agent/_components/chat-pane.tsx",
      "src/app/agent/_components/filesystem-panel.tsx",
      "src/app/agent/_components/git-diff-panel.tsx",
      "src/app/agent/_components/agent-browser.tsx",
      "src/app/agent/_components/use-workspace.ts",
      "src/app/agent/_components/agent-workspace-shell.tsx",
      "src/app/agent/sessions/page.tsx",
      "src/components/projects-nav-section.tsx",
      "src/components/left-sidebar.tsx",
      "src/components/sessions-command.tsx",
      "src/components/dashboard/control-panel/control-panel-v2.tsx",
      "src/components/dashboard/control-panel/status-section.tsx",
      "src/components/dashboard/use-dashboard-recipes.ts",
      "src/app/configs/_components/configs-view.tsx",
      "src/app/configs/_components/engines-section.tsx",
      "src/app/configs/hooks/use-configs.ts",
      "src/app/recipes/_components/vllm-runtime-panel.tsx",
      "src/app/recipes/_components/recipes-content/explore-tab.tsx",
      "src/app/recipes/_components/recipe-modal/recipe-modal.tsx",
      "src/app/recipes/_components/recipes-content/use-explore.ts",
      "src/app/recipes/_components/recipes-content/recipes-content-model.ts",
      "src/app/logs/hooks/use-logs.tsx",
      "src/app/discover/page.tsx",
      "src/app/discover/hooks/use-discover.ts",
      "src/app/setup/hooks/use-setup.ts",
      "src/app/usage/hooks/use-usage.ts",
      "src/hooks/use-downloads.ts",
      "src/hooks/use-controller-events.ts",
      "src/hooks/use-model-lifecycle.ts",
      "src/hooks/use-sidebar-status.ts",
      "src/lib/agent/workspace/store.ts",
      "src/lib/agent/workspace/effects.ts",
      "src/lib/agent/pi-runtime.ts",
      "src/lib/agent/sessions/engine.ts",
      "src/lib/agent/projects/context.tsx",
      "src/lib/agent/tools/context.tsx",
      "src/hooks/use-click-outside.ts",
      "src/lib/api/core.ts",
    ],
    rules: {
      // File-length offenses remain warnings on tracked legacy files so we can
      // refactor them gradually, but React effect hook bans are never softened.
      "max-lines": "warn",
      "max-lines-per-function": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    files: ["src/app/agent/_components/**/*.{ts,tsx}"],
    // Test files and lint fixtures stay exempt — production component files
    // (including chat-pane, use-workspace, agent-workspace-shell) MUST obey
    // the global React effect hook ban. No carve-outs.
    ignores: ["src/app/agent/_components/**/*.test.ts", "src/app/agent/_components/__lint__/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: bannedReactEffectCallSelector,
          message: "Agent workspace component files must not call React effect hooks.",
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
