// Hand-rolled i18n (research R16): flat key catalogs per locale, `{name}` placeholders, plurals
// through Intl.PluralRules (`key.one`, `key.other`, …). English is bundled; Turkish and German
// load on demand. Technical terms stay English and live in the glossary catalogs.
import en from './en.json';
import glossaryEn from './glossary.en.json';
import {
  i18nState,
  type Catalog,
  type Glossary,
  type GlossaryEntry,
  type GlossaryId,
  type Locale,
} from './state.svelte';

export type { GlossaryEntry, GlossaryId, Locale } from './state.svelte';
export const LOCALES: readonly Locale[] = ['en', 'tr', 'de'];

type EnKey = keyof typeof en;
type PluralCategory = Intl.LDMLPluralRule;
type PluralBase<K> = K extends `${infer B}.${PluralCategory}` ? B : never;
/** Every key of en.json, plus the base name of plural keys (`foo` for `foo.one`/`foo.other`). */
export type MessageKey = EnKey | PluralBase<EnKey>;
export type MessageParams = Record<string, string | number>;

type Loaded = [{ default: Catalog }, { default: Glossary }];
const loaders: Record<Exclude<Locale, 'en'>, () => Promise<Loaded>> = {
  tr: () => Promise.all([import('./tr.json'), import('./glossary.tr.json')]),
  de: () => Promise.all([import('./de.json'), import('./glossary.de.json')]),
};

export function isLocale(v: unknown): v is Locale {
  return LOCALES.includes(v as Locale);
}

export function getLocale(): Locale {
  return i18nState.locale;
}

let pending = 0;

/** Switch the UI language. Resolves once the catalog is loaded; the last call wins. */
export async function setLocale(locale: Locale): Promise<void> {
  const request = ++pending;
  const [messages, glossary] =
    locale === 'en'
      ? [en as Catalog, glossaryEn]
      : await loaders[locale]().then(([m, g]) => [m.default, g.default] as const);
  if (request !== pending) return;
  i18nState.messages = messages;
  i18nState.glossary = glossary;
  i18nState.locale = locale;
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

function reportMissing(key: string): void {
  if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
    console.error(`[i18n] missing key "${key}" in locale "${i18nState.locale}"`);
  }
}

function lookup(key: string, params: MessageParams | undefined): string | undefined {
  const messages = i18nState.messages;
  if (key in messages) return messages[key];
  const count = params?.count;
  if (typeof count === 'number' && `${key}.other` in messages) {
    const category = new Intl.PluralRules(i18nState.locale).select(count);
    return messages[`${key}.${category}`] ?? messages[`${key}.other`];
  }
  return undefined;
}

/** Translate `key` in the current locale. Reactive: components re-render on a locale change. */
export function t(key: MessageKey, params?: MessageParams): string {
  const template = lookup(key, params);
  if (template === undefined) {
    reportMissing(key);
    return `⟦${key}⟧`;
  }
  if (!params) return template;
  const numbers = new Intl.NumberFormat(i18nState.locale);
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    return typeof value === 'number' ? numbers.format(value) : value;
  });
}

/** A glossary term (English) with its explanation in the current locale. Reactive. */
export function glossary(id: GlossaryId): GlossaryEntry {
  return i18nState.glossary[id];
}
