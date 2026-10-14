// FR-037: all text meets WCAG 2.1 AA contrast (4.5:1) in both themes; the focus ring is at least
// 3:1 against the surfaces it appears on (FR-038, WCAG 1.4.11).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../../src/styles/theme.css', import.meta.url), 'utf-8');

function block(selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`${selector} not found in theme.css`);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

function colors(body: string): Record<string, string> {
  return Object.fromEntries(
    [...body.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2]]),
  );
}

const light = colors(block(':root {'));
const dark = colors(block(":root[data-theme='dark'] {"));
const darkMedia = colors(block(":root:not([data-theme='light']) {"));

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const PAGE_BACKGROUNDS = ['bg', 'surface', 'surface-raised'];
const TEXT_PAIRS: [string, string][] = [
  ...['text', 'text-muted', 'accent', 'danger'].flatMap((fg) =>
    PAGE_BACKGROUNDS.map((bg): [string, string] => [fg, bg]),
  ),
  ['text', 'accent-soft'],
  ['accent', 'accent-soft'],
  ['danger', 'danger-surface'],
  ['text', 'danger-surface'],
  ['accent-contrast', 'accent'],
  ...['panel-text', 'panel-muted'].flatMap((fg) =>
    ['panel', 'panel-raised'].map((bg): [string, string] => [fg, bg]),
  ),
];
const FOCUS_BACKGROUNDS = [...PAGE_BACKGROUNDS, 'panel', 'panel-raised', 'accent-soft'];

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme', (_, theme) => {
  it.each(TEXT_PAIRS)('%s on %s is at least 4.5:1', (fg, bg) => {
    expect(theme[fg], fg).toBeDefined();
    expect(theme[bg], bg).toBeDefined();
    expect(contrast(theme[fg]!, theme[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it('has a focus ring of at least 3:1 against every surface', () => {
    for (const bg of FOCUS_BACKGROUNDS) {
      expect(contrast(theme.focus!, theme[bg]!), bg).toBeGreaterThanOrEqual(3);
    }
  });

  it('gives control borders at least 3:1 against page backgrounds', () => {
    for (const bg of PAGE_BACKGROUNDS) {
      expect(contrast(theme['border-strong']!, theme[bg]!), bg).toBeGreaterThanOrEqual(3);
    }
  });
});

it('keeps the two dark blocks identical', () => {
  expect(darkMedia).toEqual(dark);
  expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
});
