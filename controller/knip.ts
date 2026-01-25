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
    // Barrel/index files for module exports
    'src/**/index.ts',
    'src/**/external.ts',
    // Schemas used by OpenAPI
    'src/types/schemas.ts',
    // OpenAPI routes (experimental)
    'src/routes/system-openapi.ts',
  ],
  ignoreDependencies: [
    '@types/*',
    // Used in OpenAPI routes
    '@hono/zod-openapi',
    'swagger-ui-dist',
    // Used for PostgreSQL analytics (optional feature)
    'pg',
    // Used for lint-staged hooks
    'lint-staged',
  ],
  ignoreExportsUsedInFile: true,
  // Exports that are part of public API but not used internally
  ignoreWorkspaces: [],
  rules: {
    // Allow these specific exports
    exports: 'off',
    types: 'off',
  },
};
