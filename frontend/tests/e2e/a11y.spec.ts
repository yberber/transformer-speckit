// FR-044, SC-007, Principle VI: zero axe violations (WCAG 2.1 A/AA) on every view, in both
// color schemes and all three browser locales, with every "Show details" closed and open.
// For release every view must be real: no view root may still carry `data-placeholder`.
// The live-mode states (input form, waking, error) are checked against the mocked API, so those
// tests also carry @live and run in the `live` project.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { VIEWS } from '../../src/lib/state/views';
import { mockApi, startingPage } from './live-api';

const SCHEMES = ['light', 'dark'] as const;
const LOCALES = ['en-US', 'tr-TR', 'de-DE'] as const;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function expectNoViolations(page: Page, label: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`,
  );
  expect(summary, `${label}\n${summary.join('\n')}`).toEqual([]);
}

async function openAllDetails(page: Page): Promise<void> {
  // Opening one disclosure can reveal others, so repeat until none is closed.
  for (let round = 0; round < 10; round++) {
    const closed = page.locator('[data-show-details][aria-expanded="false"]');
    const count = await closed.count();
    if (count === 0) return;
    for (let i = 0; i < count; i++) await closed.first().click();
  }
}

for (const locale of LOCALES) {
  test.describe(`@a11y ${locale}`, () => {
    test.use({ locale });

    for (const scheme of SCHEMES) {
      for (const view of VIEWS) {
        test(`@a11y ${view} view, ${scheme} scheme, ${locale}`, async ({ page }) => {
          await page.emulateMedia({ colorScheme: scheme });
          await page.goto('/');
          await page.locator(`nav a[data-view="${view}"]`).click();
          await expect(page.locator(`section[data-view="${view}"]`)).toBeVisible();
          await expect(page.locator('section[data-view][data-placeholder]')).toHaveCount(0);

          await expectNoViolations(page, `${view} / ${scheme} / ${locale} / details closed`);
          await openAllDetails(page);
          await expectNoViolations(page, `${view} / ${scheme} / ${locale} / details open`);
        });
      }
    }
  });
}

const status = (page: Page) => page.locator('[data-live-status]');

async function enterLive(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('[data-mode-switch] input[value="live"]').check();
  await expect(page.locator('[data-live-mode]')).toBeVisible();
}

const LIVE_STATES: Record<string, (page: Page) => Promise<void>> = {
  'input form': async (page) => {
    await mockApi(page);
    await enterLive(page);
    await page.locator('[data-live-input]').fill('What is the capital of France?');
    await expect(page.locator('[data-chat-tip]')).toBeVisible();
  },
  'waking status': async (page) => {
    await mockApi(page, { health: (route) => startingPage(route) });
    await enterLive(page);
    await page.locator('[data-live-input]').fill('The quick brown fox');
    await page.locator('[data-action="run"]').click();
    await expect(status(page)).toHaveAttribute('data-state', 'waking');
    await expect(page.locator('[data-action="cancel"]')).toBeVisible();
  },
  'error message': async (page) => {
    await page.route('http://api.test/**', (route) => route.abort('connectionrefused'));
    await enterLive(page);
    await expect(page.locator('[data-live-error]')).toHaveAttribute('data-code', 'network', {
      timeout: 10_000,
    });
    await expect(page.locator('[data-action="back-to-examples"]')).toBeVisible();
  },
};

for (const locale of LOCALES) {
  test.describe(`@a11y @live ${locale}`, () => {
    test.use({ locale });

    for (const scheme of SCHEMES) {
      for (const [state, reach] of Object.entries(LIVE_STATES)) {
        test(`@a11y @live live mode ${state}, ${scheme} scheme, ${locale}`, async ({ page }) => {
          await page.emulateMedia({ colorScheme: scheme });
          await reach(page);
          await expectNoViolations(page, `live ${state} / ${scheme} / ${locale}`);
        });
      }
    }
  });
}
