import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    restoreMocks: true,
    unstubGlobals: true,
    coverage: {
      provider: 'v8',
      include: ['src/config.ts', 'src/departures/utils.ts', 'src/api/api.ts', 'src/api/token-manager.ts'],
      reporter: ['text', 'html'],
    },
  },
});
