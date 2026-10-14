// Locale-aware number formatting. Defaults to the current UI locale.
import { getLocale } from './index';

/** Plain number with grouping, e.g. 124,439,808 (en) or 124.439.808 (de). */
export function formatNumber(n: number, options?: Intl.NumberFormatOptions, locale = getLocale()) {
  return new Intl.NumberFormat(locale, options).format(n);
}

/**
 * A fraction as a percentage, e.g. 0.123 → "12.3%" (en), "%12,3" (tr), "12,3 %" (de).
 * Values that are already percentages (change %) must be divided by 100 first.
 */
export function formatPercent(fraction: number, digits = 1, locale = getLocale()) {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(fraction);
}

/** A probability as a decimal with a fixed number of fraction digits, e.g. 0.0697. */
export function formatProb(p: number, digits = 4, locale = getLocale()) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(p);
}

/** Short form for large numbers, e.g. 124M (en), 124 Mio. (de). */
export function formatCompact(n: number, locale = getLocale()) {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/** Decimal byte units (1 KB = 1,000 B, 1 MB = 1,000,000 B), e.g. 75.5 MB. */
export function formatBytes(bytes: number, locale = getLocale()) {
  let value = bytes;
  let unit = 0;
  while (Math.abs(value) >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  const digits = unit === 0 ? 0 : 1;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
  return `${number} ${BYTE_UNITS[unit]}`;
}
