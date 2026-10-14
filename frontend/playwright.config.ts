import { defineConfig, devices } from '@playwright/test';

// `npm run test:e2e:fullstack` sets E2E_FULLSTACK=1: it runs only the @fullstack specs against a
// build that talks to a local backend. The default run (chromium + mobile) never needs a server.
const fullstack = process.env.E2E_FULLSTACK === '1';
const port = fullstack ? 4174 : 4173;
const backendPort = 7860;

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
        { name: 'chromium', grepInvert: /@fullstack/, use: desktop },
        {
          name: 'mobile',
          grepInvert: /@fullstack/,
          use: {
            ...devices['Desktop Chrome'],
            viewport: { width: 360, height: 780 },
            isMobile: true,
            hasTouch: true,
          },
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
          },
        ]
      : []),
  ],
});
