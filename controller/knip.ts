// CRITICAL
export default {
  entry: ['src/main.ts', 'scripts/**/*.ts'],
  project: ['src/**/*.ts', 'scripts/**/*.ts'],
  test: ['src/**/*.test.ts'],
  ignore: [
    'bun.lockb',
    'node_modules/**',
    'dist/**',
    'runtime/**',
    '.husky/**',
    'src/**/*.test.ts',
    // Barrel/index files for module exports
    'src/**/index.ts',
    'src/**/external.ts',
    // Schemas used by OpenAPI
    'src/types/schemas.ts',
    // OpenAPI routes (experimental)
    'src/routes/system-openapi.ts',
  ],
  ignoreDependencies: ['swagger-ui-dist', 'lint-staged'],
  ignoreExportsUsedInFile: true,
  // Exports that are part of public API but not used internally
  ignoreWorkspaces: [],
  rules: {
    // Allow these specific exports
    exports: 'off',
    types: 'off',
  },
};
