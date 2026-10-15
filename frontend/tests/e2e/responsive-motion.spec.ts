// FR-039: from 360 px wide no main view scrolls sideways, with every "Show details" closed and
// open (checked in the `mobile` project). FR-036: with reduced motion requested, generating a
// token and switching views runs no animation at all, and the page ends in exactly the state it
// reaches with motion.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { VIEWS } from '../../src/lib/state/views';

const EXAMPLES = new URL('../../public/data/examples/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', EXAMPLES), 'utf-8')) as {
  examples: { id: string }[];
};
const FIRST = index.examples[0]!.id;

test.use({ locale: 'en-US' });

async function openView(page: Page, view: string): Promise<void> {
  await page.locator(`nav a[data-view="${view}"]`).click();
  await expect(page.locator(`section[data-view="${view}"]`)).toBeVisible();
}

async function exampleLoaded(page: Page): Promise<void> {
  await expect(page.locator(`[data-example-option="${FIRST}"] .count`)).toHaveText(/\d/);
  await expect(page.locator('[data-step-counter]')).toHaveAttribute('data-step', '0');
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

async function expectNoSideScroll(page: Page, label: string): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${label}: page is ${scrollWidth}px wide in ${clientWidth}px`).toBeLessThan(
    clientWidth + 1,
  );
}

test.describe('@responsive', () => {
  for (const view of VIEWS) {
    test(`@responsive ${view} view has no horizontal page scroll at 360 px`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'mobile', 'the 360 px check runs in the mobile project');
      await page.goto('/');
      await exampleLoaded(page);
      await openView(page, view);
      expect(page.viewportSize()?.width).toBe(360);
      await expectNoSideScroll(page, `${view}, details closed`);
      await openAllDetails(page);
      await expectNoSideScroll(page, `${view}, details open`);
    });
  }

  /** Two frames: anything a state change started is visible to getAnimations() by then. */
  const settle = (page: Page) =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );

  const animationCount = (page: Page) => page.evaluate(() => document.getAnimations().length);

  /** Everything the visitor can see of the final state. */
  async function finalState(page: Page) {
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
    return {
      url: page.url(),
      step: await page.locator('[data-step-counter]').getAttribute('data-step'),
      view: await page.locator('nav a[aria-current="page"]').getAttribute('data-view'),
      text: await page.locator('section[data-view]').innerText(),
      chips: await page
        .locator('section[data-view] [data-token-sequence] [data-token-id]')
        .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.tokenId)),
    };
  }

  /** Generate tokens and switch views; with `check`, assert no animation after each action. */
  async function scenario(page: Page, check: boolean) {
    const actions: [string, () => Promise<void>][] = [
      ['next token', () => page.locator('[data-action="next"]').click()],
      ['next token', () => page.locator('[data-action="next"]').click()],
      ['open blocks', () => openView(page, 'blocks')],
      ['next layer', () => page.locator('[data-action="next-layer"]').click()],
      ['open tokens', () => openView(page, 'tokens')],
      ['next token', () => page.locator('[data-action="next"]').click()],
    ];
    await page.goto('/');
    await exampleLoaded(page);
    for (const [name, act] of actions) {
      await act();
      if (!check) continue;
      await settle(page);
      expect(await animationCount(page), `animations after "${name}"`).toBe(0);
    }
    await expect(page.locator('[data-step-counter]')).toHaveAttribute('data-step', '3');
    await expect(page).toHaveURL(/layer=2/);
    return finalState(page);
  }

  test('@responsive with reduced motion nothing animates and the end state is the same', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const withMotion = await scenario(page, false);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await scenario(page, true);
    expect(reduced).toEqual(withMotion);
  });
});
