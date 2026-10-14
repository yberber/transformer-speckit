// FR-027, FR-028, US8-1/2: every formula id that params.ts, flops.ts and kvcache.ts put on a value
// has an entry on "How we calculate", and every entry is complete in en, tr and de. The worked
// GPT-2 small examples come from the same functions, so they equal the hand references too.
import { describe, expect, it } from 'vitest';
import de from '../../../src/lib/i18n/de.json';
import en from '../../../src/lib/i18n/en.json';
import tr from '../../../src/lib/i18n/tr.json';
import { modelConfig } from '../../../src/lib/model/config';
import { decodeFlops, prefillFlops, runningTotalFlops } from '../../../src/lib/model/flops';
import { FORMULAS, inputLabelKey, substitute } from '../../../src/lib/model/formulas';
import { kvCacheBytes } from '../../../src/lib/model/kvcache';
import { paramGroups } from '../../../src/lib/model/params';
import { gpt2Small as ref } from '../../reference/gpt2-small';

const catalogs: Record<string, Record<string, string>> = { en, tr, de };

/** Every formula id the site can put on a value, collected by calling each function. */
function emittedIds(): Set<string> {
  const ids = new Set<string>();
  for (const g of paramGroups(modelConfig)) ids.add(g.formulaId);
  for (const b of [prefillFlops(modelConfig, 10), decodeFlops(modelConfig, 10)]) {
    for (const e of [...b.breakdown, b.total]) ids.add(e.formulaId);
  }
  ids.add(runningTotalFlops(modelConfig, 10, 3).formulaId);
  ids.add(kvCacheBytes(modelConfig, 10).formulaId);
  return ids;
}

const entries = Object.entries(FORMULAS);

/** The worked value of one variant (by its label key's last part, or the only variant). */
function worked(id: string, n: number, t: number, variant?: string): number {
  const f = FORMULAS[id];
  expect(f, id).toBeDefined();
  const v = variant ? f!.variants.find((x) => x.labelKey?.endsWith(`.${variant}`)) : undefined;
  if (variant) expect(v, `${id} ${variant}`).toBeDefined();
  else expect(f!.variants, id).toHaveLength(1);
  return (v ?? f!.variants[0]!).worked(modelConfig, { n, t });
}

describe('FORMULAS registry', () => {
  it('has an entry for every formula id emitted by params.ts, flops.ts and kvcache.ts', () => {
    const ids = emittedIds();
    // 10 parameter components, 10 FLOP formulas and the KV cache.
    expect(ids.size).toBe(21);
    for (const id of ids) expect(FORMULAS, id).toHaveProperty([id]);
  });

  it('keys every entry by its own id', () => {
    for (const [key, f] of entries) expect(f.id).toBe(key);
  });

  it.each(entries)('%s has a title in every locale', (_id, f) => {
    for (const [locale, catalog] of Object.entries(catalogs)) {
      expect(catalog[f.titleKey]?.trim(), `${locale}: ${f.titleKey}`).toBeTruthy();
    }
  });

  it.each(entries)('%s has an expression and a label for every variant', (_id, f) => {
    expect(f.variants.length).toBeGreaterThan(0);
    for (const v of f.variants) {
      expect(v.expression.trim()).not.toBe('');
      if (v.labelKey === null) continue;
      for (const [locale, catalog] of Object.entries(catalogs)) {
        expect(catalog[v.labelKey]?.trim(), `${locale}: ${v.labelKey}`).toBeTruthy();
      }
    }
  });

  it.each(entries)('%s names its inputs, each labelled in every locale', (_id, f) => {
    expect(f.inputs.length).toBeGreaterThan(0);
    for (const input of f.inputs) {
      for (const [locale, catalog] of Object.entries(catalogs)) {
        const key = inputLabelKey(input);
        expect(catalog[key]?.trim(), `${locale}: ${key}`).toBeTruthy();
      }
    }
  });

  it.each(entries)('%s gives a safe-integer worked value', (_id, f) => {
    for (const v of f.variants) {
      for (const [n, t] of [
        [1, 1],
        [10, 13],
        [64, modelConfig.nPositions],
      ] as const) {
        expect(Number.isSafeInteger(v.worked(modelConfig, { n, t }))).toBe(true);
      }
    }
  });
});

describe('worked GPT-2 small examples', () => {
  const p = ref.params;
  const perLayer = ref.decode_per_layer;

  it('equal the parameter references', () => {
    expect(worked('params-wte', 1, 1)).toBe(p.wte);
    expect(worked('params-wpe', 1, 1)).toBe(p.wpe);
    for (const [component, count] of Object.entries(p.block)) {
      const id = `params-${component}`;
      expect(worked(id, 1, 1, 'weight') + worked(id, 1, 1, 'bias'), id).toBe(count);
    }
    expect(worked('params-ln_f', 1, 1, 'weight') + worked('params-ln_f', 1, 1, 'bias')).toBe(
      p.ln_f,
    );
    // The LM head has the size of wte; tied, it adds nothing to the total.
    expect(worked('params-lm_head', 1, 1)).toBe(p.wte);
    expect(worked('params-block', 1, 1)).toBe(p.per_block);
    expect(worked('params-total', 1, 1)).toBe(p.total);
  });

  it('equal the per-layer FLOP references for decode at t = 10', () => {
    const t = 10;
    expect(worked('flops-qkv', 1, t, 'decode')).toBe(perLayer.qkv);
    expect(worked('flops-attn-scores', 1, t, 'decode')).toBe(perLayer.attn_scores_per_t * t);
    expect(worked('flops-attn-weighting', 1, t, 'decode')).toBe(perLayer.attn_weighting_per_t * t);
    expect(worked('flops-attn-out', 1, t, 'decode')).toBe(perLayer.attn_out);
    expect(worked('flops-mlp', 1, t, 'decode')).toBe(perLayer.mlp);
    expect(worked('flops-pos-add', 1, t, 'decode')).toBe(ref.pos_add);
    expect(worked('flops-lm-head', 1, t)).toBe(ref.lm_head);
  });

  it('scale the per-layer prefill items with n', () => {
    const n = 10;
    const pairs = (n * (n + 1)) / 2;
    expect(worked('flops-qkv', n, 1, 'prefill')).toBe(perLayer.qkv * n);
    expect(worked('flops-attn-scores', n, 1, 'prefill')).toBe(perLayer.attn_scores_per_t * pairs);
    expect(worked('flops-mlp', n, 1, 'prefill')).toBe(perLayer.mlp * n);
    expect(worked('flops-pos-add', n, 1, 'prefill')).toBe(ref.pos_add * n);
  });

  it.each(Object.entries(ref.decode))('equal the decode total at t = %s', (tKey, value) => {
    expect(worked('flops-decode-total', 1, Number(tKey))).toBe(value);
  });

  it.each(Object.entries(ref.prefill))('equal the prefill total at n = %s', (nKey, value) => {
    expect(worked('flops-prefill-total', Number(nKey), 1)).toBe(value);
  });

  it('use k = t − n generated tokens for the running total', () => {
    const n = 10;
    const k = 3;
    const expected = ref.prefill['10']! + [1, 2, 3].reduce((s, j) => s + decodeAt(n + j), 0);
    expect(worked('flops-running-total', n, n + k)).toBe(expected);
    // A context no longer than the input means nothing has been generated yet.
    expect(worked('flops-running-total', n, n)).toBe(ref.prefill['10']);
    expect(worked('flops-running-total', n, 1)).toBe(ref.prefill['10']);
  });

  it('equal the KV-cache references', () => {
    expect(worked('kv-cache-bytes', 1, 1)).toBe(ref.kv_cache_bytes.per_token);
    expect(worked('kv-cache-bytes', 1, 1024)).toBe(ref.kv_cache_bytes['1024']);
  });
});

describe('substitute', () => {
  const values: Record<string, string> = { n_embd: '768', n_inner: '3,072', n: '10', t: '13' };
  const value = (input: string) => values[input] ?? `<${input}>`;

  it('replaces every symbol with its value', () => {
    expect(substitute('6 · d² · n', value)).toBe('6 · 768² · 10');
    expect(substitute('d · n · (n + 1)', value)).toBe('768 · 10 · (10 + 1)');
    expect(substitute('4 · d · f', value)).toBe('4 · 768 · 3,072');
  });

  it('leaves function names and summation indices alone', () => {
    expect(substitute('prefill(n) + Σⱼ₌₁..ₖ decode(n + j), k = t − n', value)).toBe(
      'prefill(10) + Σⱼ₌₁..ₖ decode(10 + j), k = 13 − 10',
    );
  });

  it('substitutes every symbol of every expression in the registry', () => {
    for (const f of Object.values(FORMULAS)) {
      for (const v of f.variants) {
        const used = new Set<string>();
        substitute(v.expression, (input) => (used.add(input), '1'));
        for (const input of used) expect(f.inputs, `${f.id}: ${v.expression}`).toContain(input);
      }
    }
  });
});

describe('per-layer formulas', () => {
  it('are the block components and the layer FLOP items', () => {
    const perLayer = Object.values(FORMULAS)
      .filter((f) => f.perLayer)
      .map((f) => f.id)
      .sort();
    expect(perLayer).toEqual(
      [
        'params-ln_1',
        'params-attn.c_attn',
        'params-attn.c_proj',
        'params-ln_2',
        'params-mlp.c_fc',
        'params-mlp.c_proj',
        'flops-qkv',
        'flops-attn-scores',
        'flops-attn-weighting',
        'flops-attn-out',
        'flops-mlp',
      ].sort(),
    );
  });
});

/** decode(t) from the reference parts: all layers' matmuls, attention over t keys, the rest. */
function decodeAt(t: number): number {
  const perLayer = ref.decode_per_layer;
  const attentionPerT = perLayer.attn_scores_per_t + perLayer.attn_weighting_per_t;
  return (
    ref.all_layers_matmuls_without_attention +
    ref.config.n_layer * attentionPerT * t +
    ref.pos_add +
    ref.lm_head
  );
}
