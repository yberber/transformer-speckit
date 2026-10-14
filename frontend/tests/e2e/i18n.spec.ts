// US5, quickstart Q10, FR-029/FR-030, SC-008: the default language follows the browser, the
// language switch keeps everything the visitor is looking at, no translation key is missing, and
// technical terms stay English with an explanation in the UI language.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { VIEWS } from '../../src/lib/state/views';

type Locale = 'en' | 'tr' | 'de';
const LOCALES: readonly Locale[] = ['en', 'tr', 'de'];

const I18N = new URL('../../src/lib/i18n/', import.meta.url);
const readJson = <T>(file: string) => JSON.parse(readFileSync(new URL(file, I18N), 'utf-8')) as T;
const catalogs = Object.fromEntries(
  LOCALES.map((l) => [l, readJson<Record<string, string>>(`${l}.json`)]),
) as Record<Locale, Record<string, string>>;
const glossaries = Object.fromEntries(
  LOCALES.map((l) => [
    l,
    readJson<Record<string, { term: string; explanation: string }>>(`glossary.${l}.json`),
  ]),
) as Record<Locale, Record<string, { term: string; explanation: string }>>;

const index = JSON.parse(
  readFileSync(new URL('../../public/data/examples/index.json', import.meta.url), 'utf-8'),
) as { examples: { id: string }[] };

/** Views that show a run, and so the step counter. */
const RUN_VIEWS = ['tokens', 'embeddings', 'blocks', 'attention', 'prediction', 'cost'];

const MISSING = '⟦';

async function openView(page: Page, view: string): Promise<void> {
  await page.locator(`nav a[data-view="${view}"]`).click();
  await expect(page.locator(`section[data-view="${view}"]`)).toBeVisible();
}

async function switchLanguage(page: Page, locale: Locale): Promise<void> {
  await page.locator(`[data-language-switch] input[value="${locale}"]`).check();
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('h1')).toHaveText(catalogs[locale]['app.title']!);
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

test.describe('@i18n default language', () => {
  const cases: [string, Locale][] = [
    ['tr-TR', 'tr'],
    ['de-DE', 'de'],
    ['en-US', 'en'],
    ['fr-FR', 'en'],
  ];
  for (const [browserLocale, expected] of cases) {
    test.describe(browserLocale, () => {
      test.use({ locale: browserLocale });

      test(`@i18n a ${browserLocale} browser gets ${expected}`, async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('html')).toHaveAttribute('lang', expected);
        await expect(page.locator('h1')).toHaveText(catalogs[expected]['app.title']!);
        await expect(
          page.locator(`[data-language-switch] input[value="${expected}"]`),
        ).toBeChecked();
      });
    });
  }

  test.describe('stored preference', () => {
    test.use({ locale: 'en-US' });

    test('@i18n a chosen language is remembered over the browser language', async ({ page }) => {
      await page.goto('/');
      await switchLanguage(page, 'de');
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('lang', 'de');
      await expect(page.locator('h1')).toHaveText(catalogs.de['app.title']!);
    });
  });
});

test.describe('@i18n language switch', () => {
  test.use({ locale: 'en-US' });

  test('@i18n options are labelled in their own language', async ({ page }) => {
    await page.goto('/');
    const own: Record<Locale, string> = { en: 'English', tr: 'Türkçe', de: 'Deutsch' };
    for (const shown of LOCALES) {
      await switchLanguage(page, shown);
      for (const locale of LOCALES) {
        const option = page.locator(`[data-language-switch] [data-lang-option="${locale}"]`);
        await expect(option).toHaveText(own[locale]);
        await expect(option).toHaveAttribute('lang', locale);
      }
    }
  });

  const example = index.examples[1]!.id;
  const LAYER = '3';
  const HEAD = '2';
  const STEP = '2';

  /** A non-default example, layer, head, step and theme, then `view`. */
  async function setState(page: Page, view: string): Promise<void> {
    await page.goto('/');
    await page.locator(`[data-example-picker] input[value="${example}"]`).check();
    await expect(page.locator('[data-step-counter]')).toHaveAttribute('data-step', '0');
    await openView(page, 'attention');
    await page.locator('[data-layer-select]').selectOption(LAYER);
    await page.locator('[data-head-select]').selectOption(HEAD);
    for (let i = 0; i < Number(STEP); i++) await page.locator('[data-action="next"]').click();
    await expect(page.locator('[data-step-counter]')).toHaveAttribute('data-step', STEP);
    await page.locator('.theme-switch input[value="dark"]').check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await openView(page, view);
  }

  for (const view of VIEWS) {
    test(`@i18n switching on the ${view} view keeps the state`, async ({ page }) => {
      await setState(page, view);

      const section = page.locator(`section[data-view="${view}"]`);
      for (const locale of ['tr', 'de', 'en'] as const) {
        const before = await section.innerText();
        await switchLanguage(page, locale);

        await expect(section).toBeVisible();
        await expect(section).not.toHaveText(before, { useInnerText: true });
        await expect(page.locator('nav a[aria-current="page"]')).toHaveAttribute('data-view', view);
        await expect(page.locator(`[data-example-picker] input[value="${example}"]`)).toBeChecked();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        await expect(page.locator('.theme-switch input[value="dark"]')).toBeChecked();
        if (RUN_VIEWS.includes(view)) {
          await expect(page.locator('[data-step-counter]')).toHaveAttribute('data-step', STEP);
        }
        const layer = page.locator('[data-layer-label]');
        if ((await layer.count()) > 0) await expect(layer).toHaveAttribute('data-layer', LAYER);
        const head = page.locator('[data-head-label]');
        if ((await head.count()) > 0) await expect(head).toHaveAttribute('data-head', HEAD);
        await expect(page.locator('body')).not.toContainText(MISSING);
      }

      // Back on a view that shows every selector: nothing was lost on the way.
      await openView(page, 'attention');
      await expect(page.locator('[data-layer-label]')).toHaveAttribute('data-layer', LAYER);
      await expect(page.locator('[data-head-label]')).toHaveAttribute('data-head', HEAD);
      await expect(page.locator('[data-step-counter]')).toHaveAttribute('data-step', STEP);
    });

    test(`@i18n after switching, the ${view} view reads as if loaded in that language`, async ({
      page,
      browser,
    }) => {
      // Catches text computed once with the old language (e.g. a number formatted at start-up).
      await setState(page, view);
      await switchLanguage(page, 'de');
      const switched = await page.locator(`section[data-view="${view}"]`).innerText();

      const context = await browser.newContext({ locale: 'de-DE' });
      try {
        const fresh = await context.newPage();
        await setState(fresh, view);
        await expect(fresh.locator('html')).toHaveAttribute('lang', 'de');
        await expect(fresh.locator(`section[data-view="${view}"]`)).toHaveText(switched, {
          useInnerText: true,
        });
      } finally {
        await context.close();
      }
    });
  }
});

const BROWSER_LOCALE: Record<Locale, string> = { en: 'en-US', tr: 'tr-TR', de: 'de-DE' };

for (const locale of LOCALES) {
  test.describe(`@i18n ${locale} catalog`, () => {
    test.use({ locale: BROWSER_LOCALE[locale] });

    for (const view of VIEWS) {
      test(`@i18n ${view} view in ${locale}: complete, terms in English`, async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await openView(page, view);
        await expect(page.locator('body')).not.toContainText(MISSING);

        // Every term: the English term with its explanation in the UI language (FR-030), inline
        // at a main term's first appearance, behind the "?" toggle for a secondary term.
        const section = page.locator(`section[data-view="${view}"]`);
        const terms = await section.locator('[data-term]').evaluateAll((nodes) =>
          nodes.map((node) => ({
            id: node.getAttribute('data-term') ?? '',
            term: node.querySelector('[lang="en"]')?.textContent?.trim() ?? '',
            inline: node.querySelector('dfn') !== null,
            explanation:
              node.querySelector('.explanation, [role="note"]')?.textContent?.trim() ?? '',
          })),
        );
        expect(terms.filter((t) => t.inline).length, 'main terms explained inline').toBeGreaterThan(
          0,
        );
        for (const { id, term, inline, explanation } of terms) {
          expect(term).toBe(glossaries.en[id]!.term);
          const expected = glossaries[locale][id]!.explanation;
          expect(explanation).toBe(inline ? `(${expected})` : expected);
        }

        // Every glossary term the view mentions, details included, is explained in the view.
        // "LM head" is the output layer, not an attention head.
        await openAllDetails(page);
        const text = (await section.innerText()).replace(/\bLM[- ]head\b/gi, '');
        const explained = new Set(terms.map((t) => t.id));
        for (const [id, { term }] of Object.entries(glossaries.en)) {
          const mentioned = new RegExp(`\\b${term.replace(' ', '\\s+')}`, 'i').test(text);
          if (mentioned) expect(explained, `"${term}" is used in ${view}`).toContain(id);
        }
        await expect(page.locator('body')).not.toContainText(MISSING);
      });
    }
  });
}
