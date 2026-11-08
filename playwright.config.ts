import { defineConfig } from '@playwright/test';
import { join } from 'node:path';

const runtime = process.env.HA_TEST_RUNTIME;
if (!runtime || !process.env.HA_URL) {
  throw new Error('Run integration tests with pnpm test:integration so they use an isolated Home Assistant.');
}

export default defineConfig({
  testDir: './tests/integration',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/integration/setup.ts',
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.HA_URL,
    storageState: join(runtime, 'auth.json'),
    browserName: 'chromium',
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
