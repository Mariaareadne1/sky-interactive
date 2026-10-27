import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs in real Chromium (Metal ANGLE backend — SwiftShader is too slow
 * for this scene) against the dev server, or the production build with E2E_PROD=1.
 */
const prod = process.env.E2E_PROD === '1';
const port = prod ? 4386 : 5386;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${port}`,
    acceptDownloads: true,
    launchOptions: { args: ['--use-angle=metal', '--enable-gpu'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: prod ? 'npm run build && npm run preview' : 'npm run dev',
    port,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
