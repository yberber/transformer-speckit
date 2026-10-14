// FR-026, FR-042, quickstart Q4: the KV-cache size computed from the config, 2·L·t·d·4 bytes
// (keys and values, every layer, float32), equals the hand references in gpt2-small.md.
import { describe, expect, it } from 'vitest';
import { modelConfig } from '../../../src/lib/model/config';
import { kvCacheBytes } from '../../../src/lib/model/kvcache';
import { gpt2Small } from '../../reference/gpt2-small';

const ref = gpt2Small.kv_cache_bytes;

describe('kvCacheBytes', () => {
  it('equals the per-token reference at t = 1', () => {
    expect(kvCacheBytes(modelConfig, 1).value).toBe(ref.per_token);
  });

  it('equals the reference at t = 1024', () => {
    expect(kvCacheBytes(modelConfig, 1024).value).toBe(ref['1024']);
  });

  it('grows linearly with the context length', () => {
    for (const t of [2, 10, 100, modelConfig.nPositions]) {
      expect(kvCacheBytes(modelConfig, t).value).toBe(ref.per_token! * t);
    }
  });

  it('is 2·L·t·d·bytesPerValue for other precisions', () => {
    const { nLayer: L, nEmbd: d } = modelConfig;
    expect(kvCacheBytes(modelConfig, 10, 2).value).toBe(2 * L * 10 * d * 2);
  });

  it('is a labelled estimate linked to its formula', () => {
    const e = kvCacheBytes(modelConfig, 10);
    expect(e).toMatchObject({
      kind: 'bytes',
      phase: 'kv_cache',
      component: 'all',
      layer: null,
      formulaId: 'kv-cache-bytes',
      isEstimate: true,
    });
    expect(e.inputs).toMatchObject({
      t: 10,
      n_layer: modelConfig.nLayer,
      n_embd: modelConfig.nEmbd,
    });
    expect(Number.isSafeInteger(e.value)).toBe(true);
  });

  it('rejects context lengths outside 1..n_positions', () => {
    expect(() => kvCacheBytes(modelConfig, 0)).toThrow(RangeError);
    expect(() => kvCacheBytes(modelConfig, modelConfig.nPositions + 1)).toThrow(RangeError);
  });
});
