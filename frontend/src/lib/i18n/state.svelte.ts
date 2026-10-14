// Reactive i18n state. Kept in a .svelte.ts module because runes compile only there; the public
// API is in index.ts.
import en from './en.json';

export type Locale = 'en' | 'tr' | 'de';
export type Catalog = Record<string, string>;

export const i18nState: { locale: Locale; messages: Catalog } = $state({
  locale: 'en',
  messages: en,
});
