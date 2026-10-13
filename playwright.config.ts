import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Local cloud sandbox ships Chromium at a fixed path; CI uses `npx playwright install chromium`.
const localChromium = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const launchOptions = existsSync(localChromium) ? { executablePath: localChromium } : {};

/**
 * The exact production artifact (dist/) is served at `/` and at `/saga-hq/`. Tests that need mock
 * identity or seeding use a separate e2e build (dist-e2e/) — never the production artifact.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  use: { trace: 'retain-on-failure', launchOptions, locale: 'en-US' },
  webServer: [
    { command: 'node scripts/serve-static.mjs dist 4173 /', port: 4173, reuseExistingServer: true },
    {
      command: 'node scripts/serve-static.mjs dist 4174 /saga-hq/',
      url: 'http://localhost:4174/saga-hq/',
      reuseExistingServer: true,
    },
    { command: 'node scripts/serve-static.mjs dist-e2e 4175 /', port: 4175, reuseExistingServer: true },
  ],
  projects: [
    {
      name: 'prod-root',
      testMatch: /(daily|offline|essential|pwa|i18n-offline|saga)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:4173/',
        launchOptions,
        locale: 'en-US',
      },
    },
    {
      name: 'prod-subpath',
      testMatch: /(essential|offline)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:4174/saga-hq/',
        launchOptions,
        locale: 'en-US',
      },
    },
    {
      name: 'prod-mobile',
      testMatch: /(essential|mobile)\.spec\.ts/,
      use: { ...devices['Pixel 7'], baseURL: 'http://localhost:4173/', launchOptions, locale: 'en-US' },
    },
    {
      name: 'e2e-build',
      testMatch: /(accounts|a11y|responsive|perf|secretary|i18n)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:4175/',
        launchOptions,
        locale: 'en-US',
      },
    },
  ],
});
