// US7, quickstart Q10, FR-033/FR-034, SC-010: the address always holds example, view, layer,
// head, step and language; "Copy link" copies it; opening it elsewhere restores exactly that
// state, with the link's language over the browser's; a broken link falls back to a valid state
// and says so once; Back returns to the previous view. In live mode nothing is copied: the
// visitor is told why. The live-mode test runs in the `live` project (mocked API).
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { VIEWS } from '../../src/lib/state/views';
import { fill, mockApi } from './live-api';

type Catalog = Record<string, string>;
const I18N = new URL('../../src/lib/i18n/', import.meta.url);
const readJson = <T>(url: URL) => JSON.parse(readFileSync(url, 'utf-8')) as T;
const en = readJson<Catalog>(new URL('en.json', I18N));
const de = readJson<Catalog>(new URL('de.json', I18N));
const tr = readJson<Catalog>(new URL('tr.json', I18N));
const config = readJson<{ n_layer: number; n_head: number }>(
  new URL('../../src/generated/gpt2-config.json', import.meta.url),
);

const EXAMPLES = new URL('../../public/data/examples/', import.meta.url);
const index = readJson<{ examples: { id: string; length: string; core: string }[] }>(
  new URL('index.json', EXAMPLES),
);
const stepsOf = (id: string) =>
  readJson<{ run: { steps: number } }>(
    new URL(index.examples.find((e) => e.id === id)!.core, EXAMPLES),
  ).run.steps;

const FIRST = index.examples[0]!.id;
const LONG = index.examples.find((e) => e.length === 'long')!.id;

/** Views that show a run, and so the step counter. */
const RUN_VIEWS = ['tokens', 'embeddings', 'blocks', 'attention', 'prediction', 'cost'];

const notice = (page: Page) => page.locator('[data-link-notice]');
const copyButton = (page: Page) => page.locator('[data-action="copy-link"]');
const copyStatus = (page: Page) => page.locator('[data-copy-status]');

async function openView(page: Page, view: string): Promise<void> {
  await page.locator(`nav a[data-view="${view}"]`).click();
  await expect(page.locator(`section[data-view="${view}"]`)).toBeVisible();
}

/** Wait until `id`'s core.json is in: the picker shows its token count at the same moment. */
async function exampleLoaded(page: Page, id: string): Promise<void> {
  await expect(page.locator(`[data-example-option="${id}"] .count`)).toHaveText(/\d/);
}

interface Expected {
  ex: string;
  view: string;
  layer: number;
  head: number;
  step: number;
  lang: 'en' | 'tr' | 'de';
}

/** The page shows exactly `s`, as far as the current view shows it. */
async function expectState(page: Page, s: Expected): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('lang', s.lang);
  await expect(page.locator(`[data-language-switch] input[value="${s.lang}"]`)).toBeChecked();
  await expect(page.locator('nav a[aria-current="page"]')).toHaveAttribute('data-view', s.view);
  await expect(page.locator(`section[data-view="${s.view}"]`)).toBeVisible();
  await expect(page.locator(`[data-example-picker] input[value="${s.ex}"]`)).toBeChecked();
  await exampleLoaded(page, s.ex);
  if (RUN_VIEWS.includes(s.view)) {
    await expect(page.locator('[data-step-counter]')).toHaveAttribute('data-step', String(s.step));
  }
  const layer = page.locator('[data-layer-label]');
  if ((await layer.count()) > 0) await expect(layer).toHaveAttribute('data-layer', `${s.layer}`);
  const head = page.locator('[data-head-label]');
  if ((await head.count()) > 0) await expect(head).toHaveAttribute('data-head', `${s.head}`);
}

/** The query string the contract prescribes for `s` (key order, defaults left out). */
function query(s: Expected): string {
  const p = new URLSearchParams();
  p.set('ex', s.ex);
  if (s.view !== 'tokens') p.set('view', s.view);
  if (s.layer !== 1) p.set('layer', String(s.layer));
  if (s.head !== 1) p.set('head', String(s.head));
  if (s.step !== 0) p.set('step', String(s.step));
  p.set('lang', s.lang);
  return `?${p}`;
}

const search = (page: Page) => new URL(page.url()).search;

test.describe('@share copy and open a link', () => {
  test.use({ locale: 'en-US', permissions: ['clipboard-read', 'clipboard-write'] });

  const target: Expected = {
    ex: LONG,
    view: 'attention',
    layer: 5,
    head: 3,
    step: 3,
    lang: 'de',
  };

  test('@share the link restores the identical state in a fresh browser', async ({
    page,
    browser,
  }) => {
    await page.goto('/');
    await page.locator(`[data-example-picker] input[value="${LONG}"]`).check();
    await exampleLoaded(page, LONG);
    await openView(page, 'attention');
    await page.locator('[data-layer-select]').selectOption(String(target.layer));
    await page.locator('[data-head-select]').selectOption(String(target.head));
    for (let i = 0; i < target.step; i++) await page.locator('[data-action="next"]').click();
    await page.locator('[data-language-switch] input[value="de"]').check();
    await expectState(page, target);

    // The address bar always holds the state, in contract order.
    await expect.poll(() => search(page)).toBe(query(target));

    await copyButton(page).click();
    await expect(copyStatus(page)).toHaveText(de['share.copied']!);
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toBe(page.url());
    const shown = await page.locator('section[data-view="attention"]').innerText();

    // A Turkish browser that never saw the site: the link's language wins.
    const context = await browser.newContext({ locale: 'tr-TR' });
    try {
      const fresh = await context.newPage();
      await fresh.goto(link);
      await expectState(fresh, target);
      await expect(fresh.locator('h1')).toHaveText(de['app.title']!);
      await expect(fresh.locator('section[data-view="attention"]')).toHaveText(shown, {
        useInnerText: true,
      });
      expect(fresh.url()).toBe(link);
      await expect(notice(fresh)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('@share copying needs no clipboard: the link is shown to copy by hand', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
      });
    });
    await page.goto(`/${query({ ...target, lang: 'en' })}`);
    await exampleLoaded(page, LONG);
    await copyButton(page).click();
    const field = page.locator('[data-share-url]');
    await expect(field).toBeVisible();
    await expect(field).toHaveValue(page.url());
    await expect(field).toHaveAttribute('readonly', '');
    await expect(field).toBeFocused();
    expect(
      await field.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]),
    ).toEqual([0, page.url().length]);
    await expect(copyStatus(page)).toHaveText(en['share.copy_manual']!);
  });
});

test.describe('@share every view opens from its link', () => {
  test.use({ locale: 'en-US' });

  for (const view of VIEWS) {
    test(`@share ${view}`, async ({ page }) => {
      const ex = index.examples[3]!.id;
      const s: Expected = { ex, view, layer: config.n_layer, head: 2, step: 5, lang: 'tr' };
      await page.goto(`/${query(s)}`);
      await expectState(page, s);
      await expect(page.locator('h1')).toHaveText(tr['app.title']!);
      expect(search(page)).toBe(query(s));
      await expect(notice(page)).toHaveCount(0);
    });
  }

  test('@share a formula link keeps its fragment', async ({ page }) => {
    const s: Expected = { ex: FIRST, view: 'method', layer: 1, head: 1, step: 0, lang: 'en' };
    await page.goto(`/${query(s)}#kv-cache-bytes`);
    await expect(page.locator('#kv-cache-bytes')).toBeInViewport();
    await exampleLoaded(page, FIRST);
    await page.locator('[data-language-switch] input[value="de"]').check();
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect.poll(() => page.url()).toMatch(/[?&]lang=de#kv-cache-bytes$/);
  });
});

test.describe('@share broken links', () => {
  test.use({ locale: 'en-US' });

  test('@share an invalid link falls back to a valid state, says so once, and is rewritten', async ({
    page,
  }) => {
    const last = stepsOf(FIRST);
    await page.goto('/?layer=40&step=999&view=nope&utm_source=mail');

    const fallback: Expected = {
      ex: FIRST,
      view: 'tokens',
      layer: config.n_layer,
      head: 1,
      step: last,
      lang: 'en',
    };
    await expectState(page, fallback);
    await expect.poll(() => search(page)).toBe(query(fallback));

    await expect(notice(page)).toHaveCount(1);
    await expect(notice(page)).toContainText(en['notice.link_partial']!);
    // The layer is valid and kept: the Attention view shows the last layer.
    await openView(page, 'attention');
    await expect(page.locator('[data-layer-label]')).toHaveAttribute(
      'data-layer',
      String(config.n_layer),
    );
    await expect(notice(page)).toHaveCount(1);

    await notice(page).locator('[data-action="dismiss-notice"]').click();
    await expect(notice(page)).toHaveCount(0);
    await openView(page, 'cost');
    await expect(notice(page)).toHaveCount(0);

    // The rewritten address is a valid link: opening it says nothing.
    await page.reload();
    await expectState(page, { ...fallback, view: 'cost' });
    await expect(notice(page)).toHaveCount(0);
  });

  test('@share an unknown example or language falls back to the defaults', async ({ page }) => {
    await page.goto('/?ex=no-such-text&lang=fr&head=0&step=abc');
    await expectState(page, { ex: FIRST, view: 'tokens', layer: 1, head: 1, step: 0, lang: 'en' });
    await expect(notice(page)).toHaveCount(1);
    await expect.poll(() => search(page)).toBe(`?ex=${FIRST}&lang=en`);
  });

  test('@share a live-mode link opens example mode where live mode is not available', async ({
    page,
  }) => {
    await page.goto(`/?mode=live&view=attention&lang=en`);
    await expect(page.locator('[data-app]')).toHaveAttribute('data-mode', 'example');
    await expectState(page, {
      ex: FIRST,
      view: 'attention',
      layer: 1,
      head: 1,
      step: 0,
      lang: 'en',
    });
    await expect(notice(page)).toHaveCount(1);
    await expect.poll(() => search(page)).toBe(`?ex=${FIRST}&view=attention&lang=en`);
  });
});

test.describe('@share history', () => {
  test.use({ locale: 'en-US' });

  test('@share Back returns to the previous view; layer, head and step add no entries', async ({
    page,
  }) => {
    await page.goto(`/?ex=${FIRST}&lang=en`);
    await exampleLoaded(page, FIRST);
    await openView(page, 'attention');
    await page.locator('[data-layer-select]').selectOption('4');
    await page.locator('[data-head-select]').selectOption('2');
    await page.locator('[data-action="next"]').click();
    await openView(page, 'cost');
    await expect
      .poll(() => search(page))
      .toBe(`?ex=${FIRST}&view=cost&layer=4&head=2&step=1&lang=en`);

    await page.goBack();
    await expectState(page, {
      ex: FIRST,
      view: 'attention',
      layer: 4,
      head: 2,
      step: 1,
      lang: 'en',
    });

    await page.goBack();
    await expect(page.locator('nav a[aria-current="page"]')).toHaveAttribute('data-view', 'tokens');
    expect(search(page)).toBe(`?ex=${FIRST}&lang=en`);

    await page.goForward();
    await expect(page.locator('nav a[aria-current="page"]')).toHaveAttribute(
      'data-view',
      'attention',
    );
  });

  test('@share changing the example adds a history entry', async ({ page }) => {
    const other = index.examples[1]!.id;
    await page.goto(`/?ex=${FIRST}&lang=en`);
    await exampleLoaded(page, FIRST);
    await page.locator(`[data-example-picker] input[value="${other}"]`).check();
    await expect.poll(() => search(page)).toBe(`?ex=${other}&lang=en`);
    await page.goBack();
    await expect(page.locator(`[data-example-picker] input[value="${FIRST}"]`)).toBeChecked();
    expect(search(page)).toBe(`?ex=${FIRST}&lang=en`);
  });
});

test.describe('@share @live live mode', () => {
  test.use({ locale: 'en-US', permissions: ['clipboard-read', 'clipboard-write'] });

  test('@share @live "Copy link" explains that the text is not included', async ({ page }) => {
    const text = `A note only I should see ${crypto.randomUUID()}`;
    await mockApi(page);
    await page.goto('/');
    await page.locator('[data-mode-switch] input[value="live"]').check();
    await expect(page.locator('[data-app]')).toHaveAttribute('data-mode', 'live');
    await page.locator('[data-live-input]').fill(text);
    await page.locator('[data-action="run"]').click();
    await expect(page.locator('[data-live-status]')).toHaveAttribute('data-state', 'ready');

    await expect.poll(() => new URLSearchParams(search(page)).get('mode')).toBe('live');
    expect(new URLSearchParams(search(page)).has('ex')).toBe(false);

    await page.evaluate(() => navigator.clipboard.writeText('untouched'));
    await copyButton(page).click();
    await expect(copyStatus(page)).toHaveText(
      fill(en['share.live_not_included']!, { examples: en['mode.example']! }),
    );
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('untouched');
    expect(page.url()).not.toContain(encodeURIComponent(text).slice(0, 20));
    expect(decodeURIComponent(page.url())).not.toContain(text);

    // Back in example mode the button copies again.
    await page.locator('[data-mode-switch] input[value="example"]').check();
    await copyButton(page).click();
    await expect(copyStatus(page)).toHaveText(en['share.copied']!);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
  });

  test('@share @live a live-mode link opens live mode with an empty text field', async ({
    page,
  }) => {
    await mockApi(page);
    await page.goto('/?mode=live&view=attention&lang=en');
    await expect(page.locator('[data-app]')).toHaveAttribute('data-mode', 'live');
    await expect(page.locator('[data-live-input]')).toHaveValue('');
    await expect(page.locator('nav a[aria-current="page"]')).toHaveAttribute(
      'data-view',
      'attention',
    );
    await expect(notice(page)).toHaveCount(0);
  });
});
