import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatBytes,
  formatCompact,
  formatNumber,
  formatPercent,
  formatProb,
} from '../../../src/lib/i18n/format';
import { getLocale, setLocale, t, type MessageKey } from '../../../src/lib/i18n/index';
import { i18nState } from '../../../src/lib/i18n/state.svelte';

const key = (k: string) => k as MessageKey;

describe('t()', () => {
  afterEach(async () => {
    await setLocale('en');
    vi.restoreAllMocks();
  });

  it('translates, fills {name} placeholders and formats numbers for the locale', () => {
    i18nState.messages = {
      greet: 'Hello {name}, {n} tokens',
      'item.one': '{count} item',
      'item.other': '{count} items',
    };
    expect(t(key('greet'), { name: 'Ada', n: 12345 })).toBe('Hello Ada, 12,345 tokens');
    expect(t(key('greet'))).toBe('Hello {name}, {n} tokens');
  });

  it('chooses plural forms with Intl.PluralRules', () => {
    i18nState.messages = { 'item.one': '{count} item', 'item.other': '{count} items' };
    expect(t(key('item'), { count: 1 })).toBe('1 item');
    expect(t(key('item'), { count: 3 })).toBe('3 items');
    expect(t(key('item'), { count: 0 })).toBe('0 items');
  });

  it('renders a missing key visibly and reports it', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(t(key('no.such.key'))).toBe('⟦no.such.key⟧');
    expect(error).toHaveBeenCalledOnce();
  });

  it('switches locale and loads its catalog', async () => {
    await setLocale('de');
    expect(getLocale()).toBe('de');
    expect(t('app.title')).toBe('Im Inneren des Transformers');
    await setLocale('en');
    expect(getLocale()).toBe('en');
  });

  it('lets the last of two overlapping locale switches win', async () => {
    await Promise.all([setLocale('tr'), setLocale('de')]);
    expect(getLocale()).toBe('de');
  });
});

describe('number formatting', () => {
  it('formats per locale', () => {
    expect(formatNumber(124439808, undefined, 'en')).toBe('124,439,808');
    expect(formatNumber(124439808, undefined, 'de')).toBe('124.439.808');
    expect(formatPercent(0.1234, 1, 'en')).toBe('12.3%');
    expect(formatPercent(0.1234, 1, 'tr')).toBe('%12,3');
    expect(formatProb(0.06966285, 4, 'en')).toBe('0.0697');
    expect(formatProb(0.06966285, 4, 'de')).toBe('0,0697');
    expect(formatCompact(124439808, 'en')).toBe('124.4M');
  });

  it('formats bytes in decimal units', () => {
    expect(formatBytes(999, 'en')).toBe('999 B');
    expect(formatBytes(73728, 'en')).toBe('73.7 KB');
    expect(formatBytes(75497472, 'en')).toBe('75.5 MB');
    expect(formatBytes(2_000_000, 'de')).toBe('2 MB');
  });
});
