// Reactive i18n state. Kept in a .svelte.ts module because runes compile only there; the public
// API is in index.ts.
import en from './en.json';
import glossaryEn from './glossary.en.json';

export type Locale = 'en' | 'tr' | 'de';
export type Catalog = Record<string, string>;
export type GlossaryId = keyof typeof glossaryEn;
export interface GlossaryEntry {
  /** The English technical term, the same in every locale. */
  term: string;
  /** One or two plain sentences in the UI language. */
  explanation: string;
}
export type Glossary = Record<GlossaryId, GlossaryEntry>;

export const i18nState: { locale: Locale; messages: Catalog; glossary: Glossary } = $state({
  locale: 'en',
  messages: en,
  glossary: glossaryEn,
});
