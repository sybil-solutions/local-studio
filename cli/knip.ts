// CRITICAL
export default {
  entry: ['src/main.ts'],
  project: ['src/**/*.ts'],
  test: ['src/**/*.test.ts'],
  ignore: [
    'vllm-studio',
    'node_modules/**',
    '.husky/**',
  ],
  ignoreDependencies: [
    '@types/*',
    // Used for lint-staged hooks
    'lint-staged',
    // Bun types used in tsconfig
    'bun-types',
  ],
  ignoreExportsUsedInFile: true,
  // Exports are part of public API
  rules: {
    exports: 'off',
    types: 'off',
  },
};
