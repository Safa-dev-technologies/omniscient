import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    // Global setup/teardown for integration tests
    globalSetup: ['./tests/integration/global-setup.ts'],
    testTimeout: 180000, // 3 minutes for integration tests (increased for larger PDFs)
    hookTimeout: 60000, // 60 seconds for beforeEach/afterEach hooks
  },
  resolve: {
    alias: {
      '@': './src',
    },
  },
});

