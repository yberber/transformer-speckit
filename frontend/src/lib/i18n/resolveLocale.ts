// The UI language at startup (FR-029, contracts/url-state.md rule 2): `lang` in the URL > stored
// preference > browser languages (first of tr/de/en matched by primary subtag) > en.
import { isLocale, LOCALES, type Locale } from './index';

/** localStorage key of the language the visitor chose in the language switch. */
export const LANG_STORAGE_KEY = 'itt.lang';

export interface LocaleInputs {
  /** The `lang` URL parameter, if the URL has one. */
  urlLang?: string | null;
  /** Reads the stored preference. May throw (blocked storage), which counts as none. */
  stored?: () => string | null | undefined;
  /** `navigator.languages`, most preferred first. */
  navigatorLanguages: readonly string[];
}

export interface ResolvedLocale {
  locale: Locale;
  /** True if the URL named a language that does not exist, so it was replaced (US7-3). */
  urlLangInvalid: boolean;
}

function readStored(stored: LocaleInputs['stored']): Locale | null {
  try {
    const value = stored?.();
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

function fromBrowser(languages: readonly string[]): Locale | null {
  for (const tag of languages) {
    const primary = tag.split('-')[0]!.toLowerCase();
    if (LOCALES.includes(primary as Locale)) return primary as Locale;
  }
  return null;
}

export function resolveLocale({
  urlLang,
  stored,
  navigatorLanguages,
}: LocaleInputs): ResolvedLocale {
  const hasUrlLang = urlLang !== undefined && urlLang !== null;
  if (hasUrlLang && isLocale(urlLang)) return { locale: urlLang, urlLangInvalid: false };
  return {
    locale: readStored(stored) ?? fromBrowser(navigatorLanguages) ?? 'en',
    urlLangInvalid: hasUrlLang,
  };
}
