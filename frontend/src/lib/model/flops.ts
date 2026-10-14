// Theoretical FLOP estimates (research R10, data-model.md "CostEstimate"), computed from the model
// config (Principle I). Conventions: forward pass only, one multiply-add = 2 FLOPs, matrix
// multiplications only (no bias adds, layer norm, softmax, GELU or residual adds), the embedding
// lookup costs 0, the position add is shown on its own, causal attention counts only unmasked
// (query, key) pairs, and the LM head runs only for the position whose next token is predicted.
// tests/unit/model/flops.test.ts compares every value with the hand references (Principle II).
import type { ModelConfig } from './config';

export type CostKind = 'flops' | 'bytes';
export type CostPhase = 'prefill' | 'decode' | 'total' | 'kv_cache';
export type CostComponent =
  'qkv' | 'attn_scores' | 'attn_weighting' | 'attn_out' | 'mlp' | 'pos_add' | 'lm_head' | 'all';

/** What a formula used: the token counts and the config fields, by their config key. */
export type CostInputs = Partial<
  Record<'n' | 't' | 'k' | 'n_embd' | 'n_layer' | 'n_inner' | 'vocab_size', number>
>;

export interface CostEstimate {
  kind: CostKind;
  phase: CostPhase;
  component: CostComponent;
  /** 1-based block number; null for non-layer components and totals. */
  layer: number | null;
  inputs: CostInputs;
  /** Exact integer, at most 2⁵³ − 1. */
  value: number;
  /** Anchor of the formula on "How we calculate" (FR-027). */
  formulaId: string;
  isEstimate: true;
}

export interface FlopBreakdown {
  /** Every layer component in layers 1..n_layer, then the position add and the LM head. */
  breakdown: CostEstimate[];
  total: CostEstimate;
}

export interface StepCost {
  prefill: FlopBreakdown;
  /** Cost of the token appended at step k; null at step 0, before any token is generated. */
  decode: FlopBreakdown | null;
  runningTotal: CostEstimate;
}

/** The components inside one transformer block, in the order data flows through it. */
export const LAYER_COMPONENTS = [
  'qkv',
  'attn_scores',
  'attn_weighting',
  'attn_out',
  'mlp',
] as const satisfies readonly CostComponent[];
export type LayerComponent = (typeof LAYER_COMPONENTS)[number];

export const FORMULA_IDS = {
  qkv: 'flops-qkv',
  attn_scores: 'flops-attn-scores',
  attn_weighting: 'flops-attn-weighting',
  attn_out: 'flops-attn-out',
  mlp: 'flops-mlp',
  pos_add: 'flops-pos-add',
  lm_head: 'flops-lm-head',
  prefill: 'flops-prefill-total',
  decode: 'flops-decode-total',
  running: 'flops-running-total',
} as const;

export function estimate(fields: Omit<CostEstimate, 'isEstimate'>): CostEstimate {
  if (!Number.isSafeInteger(fields.value)) {
    throw new RangeError(`${fields.formulaId} = ${fields.value} is not a safe integer`);
  }
  return { ...fields, isEstimate: true };
}

/** Token counts and context lengths are whole numbers within the model's context window. */
export function checkLength(name: 'n' | 't', value: number, config: ModelConfig): void {
  if (!Number.isInteger(value) || value < 1 || value > config.nPositions) {
    throw new RangeError(`${name} = ${value} outside 1..${config.nPositions}`);
  }
}

function configInputs(c: ModelConfig): CostInputs {
  return { n_embd: c.nEmbd, n_layer: c.nLayer, n_inner: c.nInner, vocab_size: c.vocabSize };
}

/** FLOPs of one layer component; the same in every layer. */
type LayerFormulas = Record<LayerComponent, number>;

function breakdown(
  config: ModelConfig,
  phase: 'prefill' | 'decode',
  inputs: CostInputs,
  perLayer: LayerFormulas,
  posAdd: number,
  lmHead: number,
): FlopBreakdown {
  const all = { ...configInputs(config), ...inputs };
  const items: CostEstimate[] = [];
  for (let layer = 1; layer <= config.nLayer; layer++) {
    for (const component of LAYER_COMPONENTS) {
      items.push(
        estimate({
          kind: 'flops',
          phase,
          component,
          layer,
          inputs: all,
          value: perLayer[component],
          formulaId: FORMULA_IDS[component],
        }),
      );
    }
  }
  for (const [component, value] of [
    ['pos_add', posAdd],
    ['lm_head', lmHead],
  ] as const) {
    items.push(
      estimate({
        kind: 'flops',
        phase,
        component,
        layer: null,
        inputs: all,
        value,
        formulaId: FORMULA_IDS[component],
      }),
    );
  }
  const total = estimate({
    kind: 'flops',
    phase,
    component: 'all',
    layer: null,
    inputs: all,
    value: items.reduce((sum, e) => sum + e.value, 0),
    formulaId: FORMULA_IDS[phase],
  });
  return { breakdown: items, total };
}

/** Processing all n input tokens at once; yields the step-0 prediction. */
export function prefillFlops(config: ModelConfig, n: number): FlopBreakdown {
  checkLength('n', n, config);
  const d = config.nEmbd;
  const f = config.nInner;
  // Query i (1-based) sees i keys: n(n+1)/2 pairs, each a d-wide dot product (scores) and a
  // d-wide weighted sum (weighting). 2 FLOPs per multiply-add: d·n(n+1) each.
  const causal = d * n * (n + 1);
  return breakdown(
    config,
    'prefill',
    { n },
    {
      qkv: 6 * d * d * n,
      attn_scores: causal,
      attn_weighting: causal,
      attn_out: 2 * d * d * n,
      mlp: 4 * d * f * n,
    },
    d * n,
    2 * d * config.vocabSize,
  );
}

/** Processing one new token at context length t (it attends to t keys, itself included). */
export function decodeFlops(config: ModelConfig, t: number): FlopBreakdown {
  checkLength('t', t, config);
  const d = config.nEmbd;
  const f = config.nInner;
  return breakdown(
    config,
    'decode',
    { t },
    {
      qkv: 6 * d * d,
      attn_scores: 2 * d * t,
      attn_weighting: 2 * d * t,
      attn_out: 2 * d * d,
      mlp: 4 * d * f,
    },
    d,
    2 * d * config.vocabSize,
  );
}

/** prefill(n) + Σⱼ₌₁..ₖ decode(n + j): everything computed for input plus k generated tokens. */
export function runningTotalFlops(config: ModelConfig, n: number, k: number): CostEstimate {
  if (!Number.isInteger(k) || k < 0) throw new RangeError(`k = ${k} must be a whole number ≥ 0`);
  let value = prefillFlops(config, n).total.value;
  for (let j = 1; j <= k; j++) value += decodeFlops(config, n + j).total.value;
  return estimate({
    kind: 'flops',
    phase: 'total',
    component: 'all',
    layer: null,
    inputs: { ...configInputs(config), n, k },
    value,
    formulaId: FORMULA_IDS.running,
  });
}

/**
 * Cost at generation step k for nInput input tokens (research R10 step semantics): the prefill
 * yields the step-0 prediction; at step k ≥ 1 the token appended at step k is processed at
 * context length nInput + k.
 */
export function costAtStep(config: ModelConfig, nInput: number, k: number): StepCost {
  return {
    prefill: prefillFlops(config, nInput),
    decode: k >= 1 ? decodeFlops(config, nInput + k) : null,
    runningTotal: runningTotalFlops(config, nInput, k),
  };
}
