const config = {
  entry: [
    "src/app/**/{page,layout,route,error,global-error,loading,not-found,template,default}.{ts,tsx}",
    "desktop/main.ts",
    "desktop/preload.ts",
    "desktop/app-identity.ts",
    "desktop/resources/pi-extensions/*.ts",
  ],
  project: ["src/**/*.{ts,tsx}", "desktop/**/*.{ts,tsx}"],
  ignore: [".next/**", ".next-dev/**", "node_modules/**"],
  ignoreIssues: {
    "desktop/interfaces.ts": ["types"],
  },
  ignoreDependencies: [
    "tailwindcss",
    "postcss",
    "@local-studio/contracts",
    "@local-studio/agent-runtime",
    "@lydell/node-pty",
  ],
  ignoreExportsUsedInFile: true,
};

export default config;
