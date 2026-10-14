// Theoretical KV-cache size (research R10): while generating, every layer keeps the key and the
// value vector of every earlier token, so the next token needs to compute only its own. Computed
// from the model config (Principle I); tests/unit/model/kvcache.test.ts checks the references.
import type { ModelConfig } from './config';
import { checkLength, estimate, type CostEstimate } from './flops';

/** float32, as the example data and the live model use. */
export const FLOAT32_BYTES = 4;

/** 2 (keys and values) · L · t · d · bytesPerValue bytes for a context of t tokens. */
export function kvCacheBytes(
  config: ModelConfig,
  t: number,
  bytesPerValue = FLOAT32_BYTES,
): CostEstimate {
  checkLength('t', t, config);
  return estimate({
    kind: 'bytes',
    phase: 'kv_cache',
    component: 'all',
    layer: null,
    inputs: { t, n_layer: config.nLayer, n_embd: config.nEmbd },
    value: 2 * config.nLayer * t * config.nEmbd * bytesPerValue,
    formulaId: 'kv-cache-bytes',
  });
}
