// FR-022–FR-024, FR-042, quickstart Q4: the FLOP estimates computed from the config equal the
// hand references in gpt2-small.md, per layer and component, per phase and as running totals.
import { describe, expect, it } from 'vitest';
import { modelConfig } from '../../../src/lib/model/config';
import {
  costAtStep,
  decodeFlops,
  prefillFlops,
  type CostEstimate,
  type FlopBreakdown,
} from '../../../src/lib/model/flops';
import { gpt2Small } from '../../reference/gpt2-small';

const ref = gpt2Small;
const L = ref.config.n_layer;
const perLayer = ref.decode_per_layer;

/** decode(t) from the reference parts: all layers' matmuls, attention over t keys, the rest. */
function refDecode(t: number): number {
  const attentionPerT = perLayer.attn_scores_per_t + perLayer.attn_weighting_per_t;
  return (
    ref.all_layers_matmuls_without_attention + L * attentionPerT * t + ref.pos_add + ref.lm_head
  );
}

function entry(b: FlopBreakdown, component: string, layer: number | null): CostEstimate {
  const found = b.breakdown.filter((e) => e.component === component && e.layer === layer);
  expect(found, `${component} in layer ${layer}`).toHaveLength(1);
  return found[0]!;
}

function allEstimates(b: FlopBreakdown): CostEstimate[] {
  return [...b.breakdown, b.total];
}

const LAYER_COMPONENTS = ['qkv', 'attn_scores', 'attn_weighting', 'attn_out', 'mlp'] as const;

describe('decodeFlops', () => {
  const t = 10;
  const decode = decodeFlops(modelConfig, t);

  it('has every layer component in layers 1..n_layer and the non-layer items once', () => {
    expect(decode.breakdown).toHaveLength(LAYER_COMPONENTS.length * L + 2);
    for (let layer = 1; layer <= L; layer++) {
      for (const component of LAYER_COMPONENTS) entry(decode, component, layer);
    }
    entry(decode, 'pos_add', null);
    entry(decode, 'lm_head', null);
  });

  it('equals the per-layer references at t = 10', () => {
    for (let layer = 1; layer <= L; layer++) {
      expect(entry(decode, 'qkv', layer).value).toBe(perLayer.qkv);
      expect(entry(decode, 'attn_scores', layer).value).toBe(perLayer.attn_scores_per_t * t);
      expect(entry(decode, 'attn_weighting', layer).value).toBe(perLayer.attn_weighting_per_t * t);
      expect(entry(decode, 'attn_out', layer).value).toBe(perLayer.attn_out);
      expect(entry(decode, 'mlp', layer).value).toBe(perLayer.mlp);
    }
  });

  it('sums each layer to the per-token reference', () => {
    for (let layer = 1; layer <= L; layer++) {
      const sum = decode.breakdown
        .filter((e) => e.layer === layer)
        .reduce((s, e) => s + e.value, 0);
      const attention = (perLayer.attn_scores_per_t + perLayer.attn_weighting_per_t) * t;
      expect(sum).toBe(perLayer.matmuls_without_attention + attention);
    }
    const matmuls = decode.breakdown
      .filter((e) => e.component === 'qkv' || e.component === 'attn_out' || e.component === 'mlp')
      .reduce((s, e) => s + e.value, 0);
    expect(matmuls).toBe(ref.all_layers_matmuls_without_attention);
  });

  it('equals the LM head and position-add references', () => {
    expect(entry(decode, 'lm_head', null).value).toBe(ref.lm_head);
    expect(entry(decode, 'pos_add', null).value).toBe(ref.pos_add);
  });

  it.each(Object.entries(ref.decode))('decode(%s) equals the reference total', (tKey, value) => {
    const result = decodeFlops(modelConfig, Number(tKey));
    expect(result.total.value).toBe(value);
    expect(result.breakdown.reduce((s, e) => s + e.value, 0)).toBe(value);
  });

  it('labels every estimate with its phase, inputs and formula', () => {
    for (const e of decode.breakdown) {
      expect(e.kind).toBe('flops');
      expect(e.phase).toBe('decode');
      expect(e.inputs.t).toBe(t);
      expect(e.formulaId).toBe(`flops-${e.component.replace('_', '-')}`);
    }
    expect(decode.total).toMatchObject({
      phase: 'decode',
      component: 'all',
      layer: null,
      formulaId: 'flops-decode-total',
    });
  });

  it('rejects context lengths outside 1..n_positions', () => {
    expect(() => decodeFlops(modelConfig, 0)).toThrow(RangeError);
    expect(() => decodeFlops(modelConfig, 1.5)).toThrow(RangeError);
    expect(() => decodeFlops(modelConfig, modelConfig.nPositions + 1)).toThrow(RangeError);
  });
});

describe('prefillFlops', () => {
  it.each(Object.entries(ref.prefill))('prefill(%s) equals the reference total', (nKey, value) => {
    const result = prefillFlops(modelConfig, Number(nKey));
    expect(result.total.value).toBe(value);
    expect(result.breakdown.reduce((s, e) => s + e.value, 0)).toBe(value);
  });

  it('scales the layer items with n and counts only the causal triangle', () => {
    const n = 10;
    const prefill = prefillFlops(modelConfig, n);
    // Query i (1-based) sees i keys: n(n+1)/2 pairs in all, against t pairs for one decode query.
    const pairs = (n * (n + 1)) / 2;
    for (let layer = 1; layer <= L; layer++) {
      expect(entry(prefill, 'qkv', layer).value).toBe(perLayer.qkv * n);
      expect(entry(prefill, 'attn_scores', layer).value).toBe(perLayer.attn_scores_per_t * pairs);
      expect(entry(prefill, 'attn_weighting', layer).value).toBe(
        perLayer.attn_weighting_per_t * pairs,
      );
      expect(entry(prefill, 'attn_out', layer).value).toBe(perLayer.attn_out * n);
      expect(entry(prefill, 'mlp', layer).value).toBe(perLayer.mlp * n);
    }
    expect(entry(prefill, 'pos_add', null).value).toBe(ref.pos_add * n);
    // The LM head runs once, for the last position.
    expect(entry(prefill, 'lm_head', null).value).toBe(ref.lm_head);
    expect(prefill.total).toMatchObject({ phase: 'prefill', formulaId: 'flops-prefill-total' });
    for (const e of prefill.breakdown) expect(e.inputs.n).toBe(n);
  });

  it('equals decode(1) for a single token', () => {
    expect(prefillFlops(modelConfig, 1).total.value).toBe(ref.decode['1']);
  });
});

describe('costAtStep', () => {
  const n = 10;

  it('has no decode cost at step 0, and the running total is the prefill', () => {
    const cost = costAtStep(modelConfig, n, 0);
    expect(cost.decode).toBeNull();
    expect(cost.prefill.total.value).toBe(ref.prefill['10']);
    expect(cost.runningTotal.value).toBe(ref.prefill['10']);
  });

  it('runningTotal(n, k) = prefill(n) + Σⱼ₌₁..ₖ decode(n + j) for n = 10, k = 3', () => {
    const k = 3;
    const cost = costAtStep(modelConfig, n, k);
    expect(cost.decode!.total.value).toBe(refDecode(n + k));
    expect(cost.runningTotal.value).toBe(
      ref.prefill['10']! + refDecode(n + 1) + refDecode(n + 2) + refDecode(n + 3),
    );
    expect(cost.runningTotal).toMatchObject({
      kind: 'flops',
      phase: 'total',
      component: 'all',
      layer: null,
      formulaId: 'flops-running-total',
      inputs: { n, k },
    });
  });

  it('matches the reference decode formula at the reference points', () => {
    for (const [tKey, value] of Object.entries(ref.decode))
      expect(refDecode(Number(tKey))).toBe(value);
  });
});

describe('every estimate', () => {
  const samples: CostEstimate[] = [
    ...allEstimates(decodeFlops(modelConfig, 1)),
    ...allEstimates(decodeFlops(modelConfig, modelConfig.nPositions)),
    ...allEstimates(prefillFlops(modelConfig, 64)),
    ...allEstimates(prefillFlops(modelConfig, modelConfig.nPositions)),
    costAtStep(modelConfig, 10, 3).runningTotal,
  ];

  it('is a safe integer marked as an estimate', () => {
    for (const e of samples) {
      expect(Number.isSafeInteger(e.value), `${e.formulaId} = ${e.value}`).toBe(true);
      expect(e.isEstimate).toBe(true);
    }
  });
});
