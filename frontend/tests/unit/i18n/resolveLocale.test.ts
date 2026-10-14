// FR-029, US5-1, contracts/url-state.md rule 2: `lang` in the URL > stored preference >
// browser languages (first of tr/de/en by primary subtag) > en.
import { describe, expect, it } from 'vitest';
import { resolveLocale } from '../../../src/lib/i18n/resolveLocale';

const throwing = () => {
  throw new DOMException('blocked', 'SecurityError');
};

describe('resolveLocale', () => {
  it('falls back to en with nothing to go on', () => {
    expect(resolveLocale({ navigatorLanguages: [] })).toEqual({
      locale: 'en',
      urlLangInvalid: false,
    });
  });

  it.each([
    [['tr-TR'], 'tr'],
    [['de-DE'], 'de'],
    [['en-US'], 'en'],
    [['de'], 'de'],
    [['DE-at'], 'de'],
    [['fr-FR', 'de-DE'], 'de'],
    [['fr-FR', 'tr', 'de'], 'tr'],
    [['fr'], 'en'],
    [['fr-FR', 'es-ES'], 'en'],
    [['en-GB', 'de-DE'], 'en'],
  ])('browser languages %j give %s', (navigatorLanguages, locale) => {
    expect(resolveLocale({ navigatorLanguages }).locale).toBe(locale);
  });

  it('matches by primary subtag, not by prefix', () => {
    // "den" (Slave) and "trv" (Taroko) are not German or Turkish.
    expect(resolveLocale({ navigatorLanguages: ['den', 'trv-TW'] }).locale).toBe('en');
  });

  it('prefers a stored preference over the browser languages', () => {
    expect(resolveLocale({ stored: () => 'tr', navigatorLanguages: ['de-DE'] }).locale).toBe('tr');
  });

  it('ignores an invalid stored preference', () => {
    expect(resolveLocale({ stored: () => 'fr', navigatorLanguages: ['de-DE'] }).locale).toBe('de');
    expect(resolveLocale({ stored: () => null, navigatorLanguages: ['de-DE'] }).locale).toBe('de');
  });

  it('ignores a storage that throws', () => {
    expect(resolveLocale({ stored: throwing, navigatorLanguages: ['tr-TR'] })).toEqual({
      locale: 'tr',
      urlLangInvalid: false,
    });
  });

  it('prefers the URL language over everything else', () => {
    expect(
      resolveLocale({ urlLang: 'de', stored: () => 'tr', navigatorLanguages: ['tr-TR'] }),
    ).toEqual({ locale: 'de', urlLangInvalid: false });
  });

  it('does not read the storage when the URL language is valid', () => {
    expect(resolveLocale({ urlLang: 'en', stored: throwing, navigatorLanguages: [] }).locale).toBe(
      'en',
    );
  });

  it.each(['fr', 'TR', 'de-DE', ''])(
    'ignores the invalid URL language %j and flags it as replaced',
    (urlLang) => {
      expect(resolveLocale({ urlLang, stored: () => 'tr', navigatorLanguages: ['de-DE'] })).toEqual(
        { locale: 'tr', urlLangInvalid: true },
      );
      expect(resolveLocale({ urlLang, navigatorLanguages: ['de-DE'] })).toEqual({
        locale: 'de',
        urlLangInvalid: true,
      });
    },
  );

  it('does not flag a missing URL language', () => {
    expect(resolveLocale({ urlLang: null, navigatorLanguages: ['de'] }).urlLangInvalid).toBe(false);
    expect(resolveLocale({ urlLang: undefined, navigatorLanguages: ['de'] }).urlLangInvalid).toBe(
      false,
    );
  });
});
