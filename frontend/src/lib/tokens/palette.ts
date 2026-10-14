// Token colors by position (FR-035): a token keeps its color in every view and at every step,
// because the color depends only on its position. Colors repeat after PALETTE_SIZE tokens, so
// color is never the only cue: every token also shows its text and position.
//
// Each theme's colors share one OKLCH lightness and chroma (light L 0.88 C 0.075, dark L 0.40
// C 0.10), with hues 150° apart in sequence so neighboring tokens look clearly different.
// tests/unit/palette/palette.test.ts checks WCAG AA text contrast and neighbor distance.

export type Theme = 'light' | 'dark';

export const TOKEN_PALETTE: Record<Theme, readonly string[]> = {
  light: [
    '#ffc4c3',
    '#a6e8d0',
    '#eec8f7',
    '#dadca3',
    '#bbd9ff',
    '#ffcaac',
    '#9be7eb',
    '#ffc4de',
    '#bee4b5',
    '#d6d0ff',
    '#f2d39f',
    '#a4e1ff',
  ],
  dark: [
    '#742d31',
    '#00583f',
    '#5f3369',
    '#4c4b00',
    '#25467d',
    '#713408',
    '#00565d',
    '#6e2e4f',
    '#26541c',
    '#483c79',
    '#634000',
    '#005073',
  ],
};

/** Text color on every token background of a theme. */
export const TOKEN_TEXT: Record<Theme, string> = { light: '#111827', dark: '#f8fafc' };

export const PALETTE_SIZE = TOKEN_PALETTE.light.length;

export function tokenColor(position: number, theme: Theme): string {
  const palette = TOKEN_PALETTE[theme];
  return palette[((position % palette.length) + palette.length) % palette.length]!;
}

export function tokenTextColor(_position: number, theme: Theme): string {
  return TOKEN_TEXT[theme];
}
