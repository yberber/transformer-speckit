// US3, FR-019, quickstart Q4: the Architecture diagram shows every component type with the
// repeat count from the config, every weight and bias opens a panel with its real shape, count
// and share (keyboard only), the tied LM head is explained, and "Show in action" jumps to the
// view that shows the component at work.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const config = JSON.parse(
  readFileSync(new URL('../../src/generated/gpt2-config.json', import.meta.url), 'utf-8'),
) as { n_layer: number };
const shapes = JSON.parse(
  readFileSync(new URL('../reference/param-shapes.json', import.meta.url), 'utf-8'),
) as Record<string, number[]>;

const TIED = 'lm_head.weight';
const count = (shape: number[]) => shape.reduce((a, b) => a * b, 1);
const total = Object.entries(shapes)
  .filter(([name]) => name !== TIED)
  .reduce((sum, [, shape]) => sum + count(shape), 0);

const COMPONENTS = [
  'wte',
  'wpe',
  'ln_1',
  'attn.c_attn',
  'attn.c_proj',
  'ln_2',
  'mlp.c_fc',
  'mlp.c_proj',
  'ln_f',
  'lm_head',
];

const fmt = new Intl.NumberFormat('en-US');
const pct3 = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});
const shapeText = (shape: number[]) => shape.map((n) => fmt.format(n)).join(' × ');

test.use({ locale: 'en-US' });

async function openArchitecture(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('nav a[data-view="architecture"]').click();
  await expect(page.locator('section[data-view="architecture"]')).toBeVisible();
}

test.describe('@architecture', () => {
  test('@architecture the diagram shows every component type and the repeat count', async ({
    page,
  }) => {
    await openArchitecture(page);
    const view = page.locator('section[data-view="architecture"]');
    const diagram = view.locator('svg[data-architecture-diagram]');
    for (const component of COMPONENTS) {
      await expect(diagram.locator(`[data-component="${component}"]`)).toBeVisible();
    }
    await expect(diagram.locator('[data-repeat-label]')).toHaveText(
      `× ${fmt.format(config.n_layer)}`,
    );
    await expect(view.locator('[data-total-params]')).toHaveText(fmt.format(total));
  });

  test('@architecture Tab and Enter open a panel for every weight and bias', async ({ page }) => {
    await openArchitecture(page);
    const view = page.locator('section[data-view="architecture"]');
    const panel = view.locator('[data-param-panel]');
    // Layer 1 is shown: its block groups are h.0.*; the rest sit outside the blocks.
    const expected = Object.keys(shapes).filter((n) => n.startsWith('h.0.') || !n.startsWith('h.'));
    const params = view.locator('[data-param]');
    await expect(params).toHaveCount(expected.length);

    await params.first().focus();
    const seen: string[] = [];
    for (let i = 0; i < expected.length; i++) {
      const focused = page.locator(':focus');
      const name = (await focused.getAttribute('data-param'))!;
      expect(expected).toContain(name);
      seen.push(name);

      await page.keyboard.press('Enter');
      await expect(focused).toHaveAttribute('aria-pressed', 'true');
      await expect(panel.locator('[data-field="name"]')).toHaveText(name);
      await expect(panel.locator('[data-field="shape"]')).toHaveText(shapeText(shapes[name]!));
      await expect(panel.locator('[data-field="count"]')).toHaveText(
        fmt.format(count(shapes[name]!)),
      );
      if (name === TIED) {
        await expect(panel.locator('[data-tied-note]')).toBeVisible();
      } else {
        await expect(panel.locator('[data-field="share"]')).toHaveText(
          pct3.format(count(shapes[name]!) / total),
        );
      }
      await page.keyboard.press('Tab');
    }
    expect(new Set(seen)).toEqual(new Set(expected));
  });

  test('@architecture the LM head explains its tied weights', async ({ page }) => {
    await openArchitecture(page);
    const view = page.locator('section[data-view="architecture"]');
    await view.locator(`[data-param="${TIED}"]`).click();
    const note = view.locator('[data-param-panel] [data-tied-note]');
    await expect(note).toBeVisible();
    await expect(note).toContainText('wte.weight');
    await expect(view.locator('[data-param-panel] [data-field="count"]')).toHaveText(
      fmt.format(count(shapes[TIED]!)),
    );
  });

  test('@architecture "Show in action" opens the matching view', async ({ page }) => {
    await openArchitecture(page);
    let view = page.locator('section[data-view="architecture"]');

    // Attention in layer 4 → the Attention view at layer 4.
    await view.locator('select[data-layer-select]').selectOption('4');
    const cAttn = view.locator('[data-param="h.3.attn.c_attn.weight"]');
    await cAttn.focus();
    await page.keyboard.press('Enter');
    await view.locator('[data-action="show-in-action"]').click();
    await expect(page.locator('section[data-view="attention"]')).toBeVisible();
    await expect(page.locator('[data-layer-label]')).toHaveAttribute('data-layer', '4');

    // The MLP → Blocks at the same layer; wte → Embeddings; the LM head → Prediction.
    const jumps: [string, string][] = [
      ['h.3.mlp.c_fc.weight', 'blocks'],
      ['wte.weight', 'embeddings'],
      [TIED, 'prediction'],
    ];
    for (const [param, target] of jumps) {
      await page.locator('nav a[data-view="architecture"]').click();
      view = page.locator('section[data-view="architecture"]');
      await view.locator(`[data-param="${param}"]`).click();
      await view.locator('[data-action="show-in-action"]').click();
      await expect(page.locator(`section[data-view="${target}"]`)).toBeVisible();
      if (target === 'blocks') {
        await expect(page.locator('[data-layer-label]')).toHaveAttribute('data-layer', '4');
      }
    }
  });
});
