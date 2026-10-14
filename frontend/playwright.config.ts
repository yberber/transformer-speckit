import { defineConfig, devices } from '@playwright/test';

// `npm run test:e2e:fullstack` sets E2E_FULLSTACK=1: it runs only the @fullstack specs against a
// build that talks to a local backend. The default run never needs a server: chromium and mobile
// use a build without an API (live mode hidden), and the `live` project (@live, @privacy) uses a
// second build whose API, http://api.test, is mocked in the browser from the contract fixtures.
const fullstack = process.env.E2E_FULLSTACK === '1';
const port = fullstack ? 4174 : 4173;
const livePort = 4175;
const backendPort = 7860;
const LIVE_TAGS = /@live|@privacy/;

const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } };

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  projects: fullstack
    ? [{ name: 'fullstack', grep: /@fullstack/, use: desktop }]
    : [
        { name: 'chromium', grepInvert: /@fullstack|@live|@privacy/, use: desktop },
        {
          name: 'mobile',
          grepInvert: /@fullstack|@live|@privacy/,
          use: {
            ...devices['Desktop Chrome'],
            viewport: { width: 360, height: 780 },
            isMobile: true,
            hasTouch: true,
          },
        },
        {
          name: 'live',
          grep: LIVE_TAGS,
          use: { ...desktop, baseURL: `http://localhost:${livePort}` },
        },
      ],
  webServer: [
    {
      command: `npm run build && npm run preview -- --port ${port} --strictPort`,
      url: `http://localhost:${port}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: fullstack ? { VITE_API_BASE_URL: `http://127.0.0.1:${backendPort}` } : {},
    },
    ...(fullstack
      ? [
          {
            command: `uv run uvicorn app.main:app --port ${backendPort} --no-access-log`,
            cwd: '../backend',
            url: `http://127.0.0.1:${backendPort}/api/v1/health`,
            reuseExistingServer: !process.env.CI,
            timeout: 300_000,
            env: { ALLOWED_ORIGINS: `http://localhost:${port}` },
          },
        ]
      : [
          {
            // Its own output directory, so the two builds never overwrite each other.
            command: `npm run build -- --outDir dist-live && npm run preview -- --outDir dist-live --port ${livePort} --strictPort`,
            url: `http://localhost:${livePort}`,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
            env: { VITE_API_BASE_URL: 'http://api.test' },
          },
        ]),
  ],
});
