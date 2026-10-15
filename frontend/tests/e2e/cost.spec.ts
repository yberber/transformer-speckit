// US4, FR-022–FR-027, quickstart Q4: the Cost view shows prefill, decode and running-total FLOPs
// for the current step, a per-layer breakdown, a context-length chart and the KV-cache size. The
// expected values come from the hand references in gpt2-small.md, not from the code under test,
// and every estimate is labelled and links to its formula on "How we calculate".
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { gpt2Small as ref } from '../reference/gpt2-small';

const config = JSON.parse(
  readFileSync(new URL('../../src/generated/gpt2-config.json', import.meta.url), 'utf-8'),
) as { n_layer: number; n_positions: number };

const EXAMPLES = new URL('../../public/data/examples/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', EXAMPLES), 'utf-8')) as {
  examples: { id: string; core: string }[];
};
const runs = index.examples.map((e) => {
  const core = JSON.parse(readFileSync(new URL(e.core, EXAMPLES), 'utf-8')) as {
    run: { n_input: number; steps: number };
  };
  return { id: e.id, nInput: core.run.n_input, steps: core.run.steps };
});
const K = 3;
const example = runs.find((r) => r.steps >= K)!;

// --- reference formulas, assembled from the hand-computed parts of gpt2-small.md ------------

const L = ref.config.n_layer;
const perLayer = ref.decode_per_layer;
const attentionPerT = perLayer.attn_scores_per_t + perLayer.attn_weighting_per_t;

function decode(t: number): number {
  return (
    ref.all_layers_matmuls_without_attention + L * attentionPerT * t + ref.pos_add + ref.lm_head
  );
}

function prefill(n: number): number {
  // Causal attention: n(n+1)/2 (query, key) pairs instead of t per query.
  const pairs = (n * (n + 1)) / 2;
  return (
    L * (perLayer.matmuls_without_attention * n + attentionPerT * pairs) +
    ref.pos_add * n +
    ref.lm_head
  );
}

function runningTotal(n: number, k: number): number {
  let sum = prefill(n);
  for (let j = 1; j <= k; j++) sum += decode(n + j);
  return sum;
}

const kvBytes = (t: number) => ref.kv_cache_bytes.per_token! * t;

const fmt = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** Decimal units, 1 MB = 1,000,000 B (src/lib/i18n/format.ts formatBytes). */
function bytesText(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  const digits = unit === 0 ? 0 : 1;
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}

test.use({ locale: 'en-US' });

async function openCost(page: Page, steps = 0): Promise<Locator> {
  await page.goto('/');
  await page.locator(`[data-example-picker] input[value="${example.id}"]`).check();
  await expect(page.locator('[data-step-counter]')).toHaveAttribute('data-step', '0');
  await page.locator('nav a[data-view="cost"]').click();
  const view = page.locator('section[data-view="cost"]');
  await expect(view).toBeVisible();
  for (let k = 1; k <= steps; k++) {
    await page.locator('[data-action="next"]').click();
    await expect(page.locator('[data-step-counter]')).toHaveAttribute('data-step', String(k));
  }
  return view;
}

async function expectFigure(view: Locator, name: string, value: number): Promise<void> {
  const figure = view.locator(`[data-cost-figure="${name}"]`);
  await expect(figure).toHaveAttribute('data-value', String(value));
  await expect(figure.locator('[data-compact]')).toHaveText(compact.format(value));
  await expect(view.locator(`[data-exact="${name}"]`)).toHaveText(fmt.format(value));
}

test.describe('@cost', () => {
  test('@cost step 0 shows the prefill and no decode yet', async ({ page }) => {
    const view = await openCost(page);
    await view.locator('[data-cost-details] [data-show-details]').click();

    await expectFigure(view, 'prefill', prefill(example.nInput));
    await expectFigure(view, 'running-total', prefill(example.nInput));
    const decodeFigure = view.locator('[data-cost-figure="decode"]');
    await expect(decodeFigure.locator('[data-no-token]')).toContainText(/no new token yet/i);
    await expect(decodeFigure).not.toHaveAttribute('data-value');
  });

  test('@cost step 3 shows decode at n_input + 3 and the running total', async ({ page }) => {
    const view = await openCost(page, K);
    await view.locator('[data-cost-details] [data-show-details]').click();

    const n = example.nInput;
    await expectFigure(view, 'prefill', prefill(n));
    await expectFigure(view, 'decode', decode(n + K));
    await expectFigure(view, 'running-total', runningTotal(n, K));
  });

  test('@cost the per-layer table has every layer plus embeddings and LM head', async ({
    page,
  }) => {
    const view = await openCost(page, K);
    const table = view.locator('table[data-cost-table="compact"]');
    const t = example.nInput + K;

    await view.locator('[data-phase-toggle] input[value="decode"]').check();
    await expect(table.locator('tbody tr')).toHaveCount(config.n_layer + 2);
    for (let layer = 1; layer <= config.n_layer; layer++) {
      const row = table.locator(`tbody tr[data-row="layer-${layer}"]`);
      await expect(row.locator('[data-cell="qkv"]')).toHaveAttribute(
        'data-value',
        String(perLayer.qkv),
      );
      await expect(row.locator('[data-cell="attn_scores"]')).toHaveAttribute(
        'data-value',
        String(perLayer.attn_scores_per_t * t),
      );
      // Compact by default (FR-032); the exact integers are behind "Show details".
      await expect(row.locator('[data-cell="mlp"]')).toHaveText(compact.format(perLayer.mlp));
    }
    await expect(table.locator('tr[data-row="pos_add"] [data-cell="total"]')).toHaveAttribute(
      'data-value',
      String(ref.pos_add),
    );
    await expect(table.locator('tr[data-row="lm_head"] [data-cell="total"]')).toHaveAttribute(
      'data-value',
      String(ref.lm_head),
    );
    await expect(table.locator('tfoot [data-cell="total"]')).toHaveAttribute(
      'data-value',
      String(decode(t)),
    );

    await expect(table.locator('tfoot [data-cell="total"]')).toHaveText(compact.format(decode(t)));

    const exact = view.locator('table[data-cost-table="exact"]');
    await expect(exact).toHaveCount(0);
    await view.locator('[data-cost-table-details] [data-show-details]').click();
    await expect(exact.locator('tbody tr')).toHaveCount(config.n_layer + 2);
    await expect(exact.locator('tr[data-row="layer-1"] [data-cell="mlp"]')).toHaveText(
      fmt.format(perLayer.mlp),
    );
    await expect(exact.locator('tfoot [data-cell="total"]')).toHaveText(fmt.format(decode(t)));

    await view.locator('[data-phase-toggle] input[value="prefill"]').check();
    await expect(table.locator('tbody tr')).toHaveCount(config.n_layer + 2);
    await expect(table.locator('tfoot [data-cell="total"]')).toHaveAttribute(
      'data-value',
      String(prefill(example.nInput)),
    );
    await expect(exact.locator('tfoot [data-cell="total"]')).toHaveText(
      fmt.format(prefill(example.nInput)),
    );
  });

  test('@cost every estimate is labelled and links to its formula', async ({ page }) => {
    const view = await openCost(page, K);
    const estimates = view.locator('[data-estimate]');
    // Three headline figures, the per-layer table, the chart and the KV-cache panel.
    expect(await estimates.count()).toBeGreaterThanOrEqual(6);

    for (const estimate of await estimates.all()) {
      const label = estimate.locator('[data-estimate-label]').first();
      await expect(label.locator('[data-estimate-badge]')).toHaveText(/theoretical estimate/i);
      const link = label.locator('a[data-formula-link]');
      const id = (await link.getAttribute('data-formula-link'))!;
      const href = (await link.getAttribute('href'))!;
      expect(href).toMatch(/^\?(.*&)?view=method(&|#)/);
      expect(href).toContain(`ex=${example.id}`);
      expect(href.endsWith(`#${id}`)).toBe(true);
    }

    // Every column of the per-layer table names its formula too.
    const headerLinks = view.locator('table[data-cost-table="compact"] thead a[data-formula-link]');
    await expect(headerLinks).toHaveCount(5);

    await view.locator('[data-cost-figure="decode"] a[data-formula-link]').click();
    await expect(page.locator('section[data-view="method"]')).toBeVisible();
  });

  test('@cost the chart marks the current context length', async ({ page }) => {
    const view = await openCost(page, K);
    const t = example.nInput + K;
    const chart = view.locator('svg[data-cost-chart]');
    await expect(chart).toBeVisible();
    await expect(chart.locator('[data-current-marker]')).toHaveAttribute('data-t', String(t));
    await expect(view.locator('[data-chart-summary]')).toContainText(compact.format(decode(1)));
    await expect(view.locator('[data-chart-summary]')).toContainText(
      compact.format(decode(config.n_positions)),
    );

    await view.locator('[data-cost-chart-block] [data-show-table]').click();
    const rows = view.locator('table[data-chart-table] tbody tr');
    const expected = new Set<number>([t]);
    for (let p = 64; p <= config.n_positions; p += 64) expected.add(p);
    await expect(rows).toHaveCount(expected.size);
    const current = view.locator(`table[data-chart-table] tr[data-t="${t}"]`);
    await expect(current.locator('[data-cell="value"]')).toHaveText(fmt.format(decode(t)));
  });

  test('@cost the KV-cache panel shows the bytes for the current context', async ({ page }) => {
    const view = await openCost(page);
    const kv = view.locator('[data-kv-cache] [data-kv-bytes]');
    await expect(kv).toHaveAttribute('data-value', String(kvBytes(example.nInput)));
    await expect(kv).toHaveText(bytesText(kvBytes(example.nInput)));

    // The exact byte count is behind "Show details" (FR-032).
    const exact = view.locator('[data-kv-cache] [data-kv-exact]');
    await expect(exact).toHaveCount(0);
    await view.locator('[data-kv-details] [data-show-details]').click();
    await expect(exact).toContainText(fmt.format(kvBytes(example.nInput)));

    await page.locator('[data-action="next"]').click();
    await expect(kv).toHaveAttribute('data-value', String(kvBytes(example.nInput + 1)));
    await expect(exact).toContainText(fmt.format(kvBytes(example.nInput + 1)));
  });
});
