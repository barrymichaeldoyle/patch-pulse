import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'e2e/**/*.test.ts'],
    exclude: ['node_modules', 'lib', 'dist'],
  },
});
