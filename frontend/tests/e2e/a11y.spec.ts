// FR-044, SC-007, Principle VI: zero axe violations (WCAG 2.1 A/AA) on every view, in both
// color schemes and all three browser locales, with every "Show details" closed and open.
// Placeholder views are checked too, so each real view is covered as soon as it lands.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { VIEWS } from '../../src/lib/state/views';

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

          await expectNoViolations(page, `${view} / ${scheme} / ${locale} / details closed`);
          await openAllDetails(page);
          await expectNoViolations(page, `${view} / ${scheme} / ${locale} / details open`);
        });
      }
    }
  });
}
