// SC-006, FR-038, FR-043, Principle VI: every FR-043 scenario works with the keyboard alone.
// Nothing here clicks or uses the mouse: focus moves only with Tab / Shift+Tab, and controls are
// used with Enter, Space, arrow keys and typing. On every focus stop the focused element must
// show a visible focus indicator. The live-mode tests carry @live as well, so they run in the
// `live` project against the mocked API (live-api.ts).
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockApi } from './live-api';

const readJson = <T>(url: URL) => JSON.parse(readFileSync(url, 'utf-8')) as T;
const config = readJson<{ n_layer: number; n_head: number }>(
  new URL('../../src/generated/gpt2-config.json', import.meta.url),
);
const EXAMPLES = new URL('../../public/data/examples/', import.meta.url);
const index = readJson<{ examples: { id: string; core: string }[] }>(
  new URL('index.json', EXAMPLES),
);
const ids = index.examples.map((e) => e.id);

test.use({ locale: 'en-US' });

/** The most Tab presses a walk to one control may take before the test gives up. */
const MAX_STOPS = 200;

/**
 * Whether the focused element draws a focus indicator: an outline or a box-shadow ring. The
 * segmented switches (language, mode, theme) hide their radio and draw the ring on its label;
 * focusable SVG parts (the Architecture diagram) draw it as a stroke in the focus color.
 */
async function focusRing(page: Page): Promise<{ ok: boolean; what: string }> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { ok: true, what: 'body' };
    const target =
      el instanceof HTMLInputElement && getComputedStyle(el).opacity === '0'
        ? (el.closest('label') ?? el)
        : el;
    const s = getComputedStyle(target);
    const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
    const shadow = s.boxShadow !== 'none';
    let stroke = false;
    if (el instanceof SVGElement) {
      const probe = document.createElement('span');
      probe.style.color = 'var(--color-focus)';
      document.body.append(probe);
      const focusColor = getComputedStyle(probe).color;
      probe.remove();
      stroke = [el, ...el.querySelectorAll('*')].some(
        (part) => getComputedStyle(part).stroke === focusColor,
      );
    }
    const what = `${el.tagName.toLowerCase()}${[...el.attributes]
      .filter((a) => a.name.startsWith('data-') || a.name === 'value' || a.name === 'class')
      .map((a) => `[${a.name}="${a.value}"]`)
      .join('')}`;
    return { ok: outline || shadow || stroke, what };
  });
}

async function expectFocusVisible(page: Page): Promise<void> {
  const { ok, what } = await focusRing(page);
  expect(ok, `no visible focus indicator on ${what}`).toBe(true);
}

const isFocused = (target: Locator) =>
  target.evaluate((el) => el === document.activeElement).catch(() => false);

/** Press Tab (or Shift+Tab) until `target` has focus, checking the focus ring at every stop. */
async function tabTo(page: Page, target: Locator, backwards = false): Promise<void> {
  await expect(target).toBeVisible();
  for (let stop = 0; stop < MAX_STOPS; stop++) {
    if (await isFocused(target)) {
      await expectFocusVisible(page);
      return;
    }
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
    await expectFocusVisible(page);
  }
  throw new Error(`could not reach ${target} with ${backwards ? 'Shift+Tab' : 'Tab'}`);
}

async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
  await expectFocusVisible(page);
}

async function openView(page: Page, view: string): Promise<void> {
  await tabTo(page, page.locator(`nav a[data-view="${view}"]`));
  await press(page, 'Enter');
  await expect(page.locator(`section[data-view="${view}"]`)).toBeVisible();
  await expect(page.locator('nav a[aria-current="page"]')).toHaveAttribute('data-view', view);
}

const stepCounter = (page: Page) => page.locator('[data-step-counter]');
const checkedExample = (page: Page) =>
  page.locator('[data-example-picker] input:checked').getAttribute('value');

async function exampleLoaded(page: Page, id: string): Promise<void> {
  await expect(page.locator(`[data-example-picker] input[value="${id}"]`)).toBeChecked();
  await expect(page.locator(`[data-example-option="${id}"] .count`)).toHaveText(/\d/);
  await expect(stepCounter(page)).toHaveAttribute('data-step', '0');
}

test.describe('@keyboard', () => {
  test('@keyboard the skip link moves focus to the main content', async ({ page }) => {
    await page.goto('/');
    await exampleLoaded(page, ids[0]!);
    await press(page, 'Tab');
    const skip = page.locator('.skip-link');
    expect(await isFocused(skip)).toBe(true);
    await expect(skip).toBeVisible();
    // The skip target is not a tab stop (tabindex="-1"), so it draws no ring of its own; the
    // next Tab lands on the first control inside it, which does.
    await page.keyboard.press('Enter');
    const main = page.locator('main#main');
    expect(await isFocused(main)).toBe(true);
    await press(page, 'Tab');
    expect(await main.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  });

  test('@keyboard open an example with the arrow keys', async ({ page }) => {
    await page.goto('/');
    await exampleLoaded(page, ids[0]!);
    // Only the checked radio of the group is a tab stop; the arrow keys choose another.
    await tabTo(page, page.locator(`[data-example-picker] input[value="${ids[0]}"]`));
    await press(page, 'ArrowDown');
    const second = await checkedExample(page);
    expect(second).not.toBe(ids[0]);
    await exampleLoaded(page, second!);
    await press(page, 'ArrowUp');
    await exampleLoaded(page, ids[0]!);
  });

  test('@keyboard generate the next token with Enter and Space, and go back', async ({ page }) => {
    await page.goto('/');
    await exampleLoaded(page, ids[0]!);
    const next = page.locator('[data-action="next"]');
    await tabTo(page, next);
    await press(page, 'Enter');
    await expect(stepCounter(page)).toHaveAttribute('data-step', '1');
    await press(page, 'Space');
    await expect(stepCounter(page)).toHaveAttribute('data-step', '2');
    await tabTo(page, page.locator('[data-action="back"]'), true);
    await press(page, 'Enter');
    await expect(stepCounter(page)).toHaveAttribute('data-step', '1');
  });

  test('@keyboard step to the last token: focus stays on a usable button', async ({ page }) => {
    await page.goto('/');
    await exampleLoaded(page, ids[0]!);
    const next = page.locator('[data-action="next"]');
    await tabTo(page, next);
    while (await next.isEnabled()) await press(page, 'Enter');
    await expect(page.locator('[data-end-message]')).toBeVisible();
    // "Next token" is disabled now; focus moved to "Back" rather than being lost.
    expect(await isFocused(page.locator('[data-action="back"]'))).toBe(true);
  });

  test('@keyboard step through the layers in the Blocks view', async ({ page }) => {
    await page.goto('/');
    await exampleLoaded(page, ids[0]!);
    await openView(page, 'blocks');
    const view = page.locator('section[data-view="blocks"]');
    const label = view.locator('[data-layer-label]');
    await expect(label).toHaveAttribute('data-layer', '1');

    const next = view.locator('[data-action="next-layer"]');
    await tabTo(page, next);
    for (let layer = 2; layer <= config.n_layer; layer++) {
      await press(page, 'Enter');
      await expect(label).toHaveAttribute('data-layer', String(layer));
    }
    await expect(next).toBeDisabled();
    // The disabled button handed focus to "Previous".
    const prev = view.locator('[data-action="prev-layer"]');
    expect(await isFocused(prev)).toBe(true);
    await press(page, 'Enter');
    await expect(label).toHaveAttribute('data-layer', String(config.n_layer - 1));
  });

  test('@keyboard change the attention head and move through the heatmap', async ({ page }) => {
    await page.goto('/');
    await exampleLoaded(page, ids[0]!);
    await openView(page, 'attention');
    const view = page.locator('section[data-view="attention"]');
    const head = view.locator('[data-head-label]');
    await expect(head).toHaveAttribute('data-head', '1');

    await tabTo(page, view.locator('[data-action="next-head"]'));
    await press(page, 'Enter');
    await expect(head).toHaveAttribute('data-head', '2');
    await press(page, 'Space');
    await expect(head).toHaveAttribute('data-head', '3');

    const heatmap = view.locator('[data-heatmap]');
    await expect(heatmap).not.toHaveAttribute('data-mode', 'pending');
    if ((await heatmap.getAttribute('data-mode')) === 'grid') {
      // Wide screens: one grid widget with a roving active cell.
      const grid = view.locator('[data-heatmap-grid]');
      await tabTo(page, grid);
      // Tabbing past the tokens above moved the active cell to the last token's pair.
      await press(page, 'Control+Home');
      await expect(grid).toHaveAttribute('data-active', '0,0');
      await press(page, 'ArrowDown');
      await press(page, 'ArrowRight');
      await expect(grid).toHaveAttribute('data-active', '1,1');
      await press(page, 'Home');
      await expect(grid).toHaveAttribute('data-active', '1,0');
      await expect(view.locator('[data-heatmap-readout]')).not.toBeEmpty();
    } else {
      // Narrow screens: the focused mode picks one token with a native select.
      const select = view.locator('[data-focus-token]');
      await tabTo(page, select);
      const before = await select.inputValue();
      await press(page, 'Home');
      await expect(select).not.toHaveValue(before);
      await expect(select).toHaveValue('0');
    }
  });

  test('@keyboard switch the language with the arrow keys', async ({ page }) => {
    await page.goto('/');
    await exampleLoaded(page, ids[0]!);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await tabTo(page, page.locator('[data-language-switch] input[value="en"]'));
    await press(page, 'ArrowRight');
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    await press(page, 'ArrowRight');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    // Nothing else changed: same example, step 0.
    await exampleLoaded(page, ids[0]!);
  });

  test('@keyboard open a shared link and keep going from there', async ({ page }) => {
    const ex = ids[1]!;
    await page.goto(`/?ex=${ex}&view=attention&layer=5&head=3&step=2&lang=de`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    const view = page.locator('section[data-view="attention"]');
    await expect(view).toBeVisible();
    await expect(page.locator(`[data-example-picker] input[value="${ex}"]`)).toBeChecked();
    await expect(view.locator('[data-layer-label]')).toHaveAttribute('data-layer', '5');
    await expect(view.locator('[data-head-label]')).toHaveAttribute('data-head', '3');
    await expect(stepCounter(page)).toHaveAttribute('data-step', '2');

    await tabTo(page, view.locator('[data-action="next-head"]'));
    await press(page, 'Enter');
    await expect(view.locator('[data-head-label]')).toHaveAttribute('data-head', '4');
    await tabTo(page, page.locator('[data-action="next"]'), true);
    await press(page, 'Enter');
    await expect(stepCounter(page)).toHaveAttribute('data-step', '3');
    await expect(page).toHaveURL(/head=4/);
    await expect(page).toHaveURL(/step=3/);
  });

  test('@keyboard every view can be opened from the navigation', async ({ page }) => {
    await page.goto('/');
    await exampleLoaded(page, ids[0]!);
    for (const view of [
      'embeddings',
      'blocks',
      'attention',
      'prediction',
      'architecture',
      'cost',
      'method',
      'tokens',
    ]) {
      // Shift+Tab: after opening a view, focus is still on its link in the navigation.
      await tabTo(page, page.locator(`nav a[data-view="${view}"]`), true);
      await press(page, 'Enter');
      await expect(page.locator(`section[data-view="${view}"]`)).toBeVisible();
    }
  });
});

test.describe('@keyboard @live', () => {
  async function switchToLive(page: Page): Promise<void> {
    await page.goto('/');
    await tabTo(page, page.locator('[data-mode-switch] input[value="example"]'));
    await press(page, 'ArrowRight');
    await expect(page.locator('[data-app]')).toHaveAttribute('data-mode', 'live');
    await expect(page.locator('[data-live-mode]')).toBeVisible();
  }

  test('@keyboard @live type a text, run it and step through the result', async ({ page }) => {
    await mockApi(page);
    await switchToLive(page);
    await tabTo(page, page.locator('[data-live-input]'));
    await page.keyboard.type('The quick brown fox');
    await tabTo(page, page.locator('[data-action="run"]'));
    await press(page, 'Enter');
    await expect(page.locator('[data-live-status]')).toHaveAttribute('data-state', 'ready');

    await tabTo(page, page.locator('[data-action="next"]'));
    await press(page, 'Enter');
    await expect(stepCounter(page)).toHaveAttribute('data-step', '1');
    await openView(page, 'attention');
    await tabTo(page, page.locator('[data-action="next-head"]'));
    await press(page, 'Enter');
    await expect(page.locator('[data-head-label]')).toHaveAttribute('data-head', '2');
  });

  test('@keyboard @live with the service unavailable, go back to the examples', async ({
    page,
  }) => {
    await page.route('http://api.test/**', (route) => route.abort('connectionrefused'));
    await switchToLive(page);
    const error = page.locator('[data-live-error]');
    await expect(error).toHaveAttribute('data-code', 'network', { timeout: 10_000 });

    // Running anyway gives the same message, again reachable from the keyboard.
    await tabTo(page, page.locator('[data-live-input]'));
    await page.keyboard.type('The quick brown fox');
    await tabTo(page, page.locator('[data-action="run"]'));
    await press(page, 'Enter');
    await expect(error).toHaveAttribute('data-code', 'network', { timeout: 10_000 });

    await tabTo(page, page.locator('[data-action="back-to-examples"]'));
    await press(page, 'Enter');
    await expect(page.locator('[data-app]')).toHaveAttribute('data-mode', 'example');
    await exampleLoaded(page, ids[0]!);
    await tabTo(page, page.locator('[data-action="next"]'));
    await press(page, 'Enter');
    await expect(stepCounter(page)).toHaveAttribute('data-step', '1');
  });
});
