import { describe, expect, it } from 'vitest';
import {
  PALETTE_SIZE,
  TOKEN_PALETTE,
  tokenColor,
  tokenTextColor,
  type Theme,
} from '../../../src/lib/tokens/palette';

const THEMES: Theme[] = ['light', 'dark'];

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function linear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

// WCAG 2.1 relative luminance and contrast ratio.
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(linear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// CIE76 ΔE: Euclidean distance in CIELAB (D65).
function lab(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map(linear) as [number, number, number];
  const xyz = [
    (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047,
    0.2126 * r + 0.7152 * g + 0.0722 * b,
    (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883,
  ].map((t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116));
  const [fx, fy, fz] = xyz as [number, number, number];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

// Neighboring tokens must be told apart at a glance. A ΔE of about 2 is "just noticeable";
// 20 is a clearly different color.
const MIN_NEIGHBOR_DELTA_E = 20;

describe('token palette', () => {
  it('has 12 colors in each theme', () => {
    expect(PALETTE_SIZE).toBe(12);
    for (const theme of THEMES) expect(TOKEN_PALETTE[theme]).toHaveLength(PALETTE_SIZE);
  });

  it.each(THEMES)('meets WCAG AA (4.5:1) for text on every %s color', (theme) => {
    for (const [i, color] of TOKEN_PALETTE[theme].entries()) {
      expect(contrast(color, tokenTextColor(i, theme)), color).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(THEMES)('makes neighboring %s colors clearly different (ΔE > 20)', (theme) => {
    const p = TOKEN_PALETTE[theme];
    for (let i = 0; i < p.length; i++) {
      // Includes the wrap-around: position 11 and position 12 are neighbors too.
      const next = p[(i + 1) % p.length]!;
      expect(deltaE(p[i]!, next), `${p[i]} vs ${next}`).toBeGreaterThan(MIN_NEIGHBOR_DELTA_E);
    }
  });

  it('assigns colors by position only, repeating after the palette size', () => {
    for (const theme of THEMES) {
      expect(tokenColor(0, theme)).toBe(TOKEN_PALETTE[theme][0]);
      expect(tokenColor(PALETTE_SIZE + 3, theme)).toBe(tokenColor(3, theme));
      expect(
        new Set(Array.from({ length: PALETTE_SIZE }, (_, i) => tokenColor(i, theme))).size,
      ).toBe(PALETTE_SIZE);
    }
  });
});
