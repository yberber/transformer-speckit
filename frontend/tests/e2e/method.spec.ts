// US8, FR-027, FR-028, quickstart Q4: every formula link in the Cost and Architecture views opens
// "How we calculate" with its formula focused and in view; the worked GPT-2 small examples equal
// the hand references in gpt2-small.md for the current text; and in the interactive panel,
// changing n and t recomputes every result at once. Expected values come from the references,
// not from the code under test.
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { gpt2Small as ref } from '../reference/gpt2-small';

const config = JSON.parse(
  readFileSync(new URL('../../src/generated/gpt2-config.json', import.meta.url), 'utf-8'),
) as { n_embd: number; n_layer: number; vocab_size: number; n_positions: number };
const limits = JSON.parse(
  readFileSync(new URL('../../../contracts/limits.json', import.meta.url), 'utf-8'),
) as { max_input_tokens: number };

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
const pairs = (n: number) => (n * (n + 1)) / 2;

function decode(t: number): number {
  return (
    ref.all_layers_matmuls_without_attention + L * attentionPerT * t + ref.pos_add + ref.lm_head
  );
}

function prefill(n: number): number {
  return (
    L * (perLayer.matmuls_without_attention * n + attentionPerT * pairs(n)) +
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

/** Expected worked values by formula id and variant, for input length n and context length t. */
function expected(n: number, t: number): Record<string, Record<string, number>> {
  const p = ref.params;
  const tie = ref.params.wte;
  return {
    'params-wte': { value: p.wte },
    'params-wpe': { value: p.wpe },
    'params-lm_head': { value: tie },
    'params-block': { value: p.per_block },
    'params-total': { value: p.total },
    'flops-qkv': { prefill: perLayer.qkv * n, decode: perLayer.qkv },
    'flops-attn-scores': {
      prefill: perLayer.attn_scores_per_t * pairs(n),
      decode: perLayer.attn_scores_per_t * t,
    },
    'flops-attn-weighting': {
      prefill: perLayer.attn_weighting_per_t * pairs(n),
      decode: perLayer.attn_weighting_per_t * t,
    },
    'flops-attn-out': { prefill: perLayer.attn_out * n, decode: perLayer.attn_out },
    'flops-mlp': { prefill: perLayer.mlp * n, decode: perLayer.mlp },
    'flops-pos-add': { prefill: ref.pos_add * n, decode: ref.pos_add },
    'flops-lm-head': { value: ref.lm_head },
    'flops-prefill-total': { value: prefill(n) },
    'flops-decode-total': { value: decode(t) },
    'flops-running-total': { value: runningTotal(n, Math.max(0, t - n)) },
    'kv-cache-bytes': { value: kvBytes(t) },
  };
}

const fmt = new Intl.NumberFormat('en-US');

test.use({ locale: 'en-US' });

async function openView(page: Page, view: string, steps = 0): Promise<Locator> {
  await page.goto('/');
  await page.locator(`[data-example-picker] input[value="${example.id}"]`).check();
  await expect(page.locator('[data-step-counter]')).toHaveAttribute('data-step', '0');
  // Steps are taken in a view that shows the generation controls.
  if (steps > 0) await page.locator('nav a[data-view="cost"]').click();
  for (let k = 1; k <= steps; k++) {
    await page.locator('[data-action="next"]').click();
    await expect(page.locator('[data-step-counter]')).toHaveAttribute('data-step', String(k));
  }
  await page.locator(`nav a[data-view="${view}"]`).click();
  const section = page.locator(`section[data-view="${view}"]`);
  await expect(section).toBeVisible();
  return section;
}

/** Clicks a formula link and checks that its formula opens, focused and in view. */
async function followLink(page: Page, link: Locator, id: string): Promise<void> {
  const href = (await link.getAttribute('href'))!;
  expect(href).toMatch(/^\?(.*&)?view=method(&|#)/);
  expect(href.endsWith(`#${id}`)).toBe(true);
  await link.click();
  await expect(page.locator('section[data-view="method"]')).toBeVisible();
  const target = page.locator(`[id="${id}"]`);
  await expect(target).toHaveAttribute('data-formula', id);
  await expect(target).toBeFocused();
  await expect(target).toBeInViewport();
}

function worked(method: Locator, id: string, variant: string): Locator {
  return method.locator(`[data-formula="${id}"] [data-variant="${variant}"] [data-worked-value]`);
}

async function expectWorked(method: Locator, n: number, t: number): Promise<void> {
  for (const [id, variants] of Object.entries(expected(n, t))) {
    for (const [variant, value] of Object.entries(variants)) {
      const cell = worked(method, id, variant);
      await expect(cell, `${id} ${variant}`).toHaveAttribute('data-value', String(value));
      await expect(cell, `${id} ${variant}`).toHaveText(fmt.format(value));
    }
  }
  // Components with a weight and a bias: the two parts add up to the reference.
  for (const [component, count] of Object.entries({
    ...ref.params.block,
    ln_f: ref.params.ln_f,
  })) {
    const id = `params-${component}`;
    const weight = Number(await worked(method, id, 'weight').getAttribute('data-value'));
    const bias = Number(await worked(method, id, 'bias').getAttribute('data-value'));
    expect(weight + bias, id).toBe(count);
  }
}

test.describe('@method', () => {
  test('@method every formula link in the Cost view opens its formula', async ({ page }) => {
    const cost = await openView(page, 'cost', K);
    const ids = new Set(
      await cost
        .locator('[data-formula-link]')
        .evaluateAll((links) => links.map((a) => a.getAttribute('data-formula-link')!)),
    );
    // The three headline figures, five table columns, two non-layer rows, the table total, the
    // chart and the KV cache: the prefill, decode and running totals plus eight items.
    expect(ids.size).toBeGreaterThanOrEqual(11);

    for (const id of ids) {
      await page.locator('nav a[data-view="cost"]').click();
      await expect(cost).toBeVisible();
      await followLink(page, cost.locator(`[data-formula-link="${id}"]`).first(), id);
    }
  });

  test('@method the Architecture view links its counts to their formulas', async ({ page }) => {
    const arch = await openView(page, 'architecture');
    await followLink(page, arch.locator('a[data-formula-link="params-total"]'), 'params-total');

    for (const [param, id] of [
      ['wte.weight', 'params-wte'],
      ['h.0.attn.c_attn.weight', 'params-attn.c_attn'],
      ['h.0.mlp.c_fc.bias', 'params-mlp.c_fc'],
      ['lm_head.weight', 'params-lm_head'],
    ] as const) {
      await page.locator('nav a[data-view="architecture"]').click();
      await arch.locator(`[data-param="${param}"]`).click();
      const link = arch.locator('[data-param-panel] a[data-formula-link]');
      await expect(link).toHaveAttribute('data-formula-link', id);
      await followLink(page, link, id);
    }
  });

  test('@method the worked examples equal the references for the current text', async ({
    page,
  }) => {
    const method = await openView(page, 'method', K);
    const n = example.nInput;
    const t = n + K;
    const args = method.locator('[data-method-args]');
    await expect(args).toHaveAttribute('data-n', String(n));
    await expect(args).toHaveAttribute('data-t', String(t));

    await expectWorked(method, n, t);

    // Each formula names its inputs with the config values.
    const inputs = method.locator('[data-formula="flops-decode-total"] [data-inputs]');
    for (const [key, value] of [
      ['n_embd', config.n_embd],
      ['n_layer', config.n_layer],
      ['vocab_size', config.vocab_size],
    ] as const) {
      await expect(inputs.locator(`[data-input-key="${key}"]`)).toContainText(fmt.format(value));
    }
    await expect(inputs.locator('[data-input-key="t"]')).toContainText(String(t));
  });

  test('@method the targeted formula gets focus when the fragment changes', async ({ page }) => {
    const method = await openView(page, 'method');
    await page.evaluate(() => (location.hash = '#flops-mlp'));
    const target = method.locator('[id="flops-mlp"]');
    await expect(target).toBeFocused();
    await expect(target).toBeInViewport();
  });

  test('@method changing n and t recomputes every result immediately', async ({ page }) => {
    const method = await openView(page, 'method');
    const nInput = method.locator('input[data-input="n"]');
    const tInput = method.locator('input[data-input="t"]');
    const summary = method.locator('[data-method-summary]');
    await expect(summary).toHaveAttribute('aria-live', 'polite');

    await nInput.fill('10');
    await tInput.fill(String(config.n_positions));
    await expectWorked(method, 10, config.n_positions);
    await expect(worked(method, 'flops-prefill-total', 'value')).toHaveAttribute(
      'data-value',
      String(ref.prefill['10']),
    );
    await expect(worked(method, 'flops-decode-total', 'value')).toHaveAttribute(
      'data-value',
      String(ref.decode[String(config.n_positions)]),
    );
    await expect(worked(method, 'kv-cache-bytes', 'value')).toHaveAttribute(
      'data-value',
      String(ref.kv_cache_bytes[String(config.n_positions)]),
    );
    await expect(summary).toContainText(fmt.format(ref.prefill['10']!));
    await expect(summary).toContainText(fmt.format(decode(config.n_positions)));

    await nInput.fill('64');
    await expect(worked(method, 'flops-prefill-total', 'value')).toHaveAttribute(
      'data-value',
      String(ref.prefill['64']),
    );
    await expect(summary).toContainText(fmt.format(ref.prefill['64']!));

    // Out of range: an inline message, and the nearest valid value is used.
    await nInput.fill(String(limits.max_input_tokens + 100));
    await expect(nInput).toHaveAttribute('aria-invalid', 'true');
    await expect(method.locator('[data-validation="n"]')).toBeVisible();
    await expect(worked(method, 'flops-prefill-total', 'value')).toHaveAttribute(
      'data-value',
      String(prefill(limits.max_input_tokens)),
    );

    await tInput.fill('0');
    await expect(tInput).toHaveAttribute('aria-invalid', 'true');
    await expect(method.locator('[data-validation="t"]')).toBeVisible();
    await expect(worked(method, 'flops-decode-total', 'value')).toHaveAttribute(
      'data-value',
      String(ref.decode['1']),
    );

    await tInput.fill('100');
    await expect(tInput).not.toHaveAttribute('aria-invalid', 'true');
    await expect(method.locator('[data-validation="t"]')).toHaveCount(0);
    await expectWorked(method, limits.max_input_tokens, 100);
  });
});
