import { describe, expect, it } from 'vitest';
import raw from '../../../src/generated/gpt2-config.json';
import {
  ConfigError,
  activationLabelKey,
  modelConfig,
  validateConfig,
} from '../../../src/lib/model/config';

const base = (): Record<string, unknown> => structuredClone(raw) as Record<string, unknown>;

describe('model config', () => {
  it('loads the bundled config', () => {
    expect(modelConfig.nLayer).toBe(raw.n_layer);
    expect(modelConfig.nHead).toBe(raw.n_head);
    expect(modelConfig.nEmbd).toBe(raw.n_embd);
    expect(modelConfig.vocabSize).toBe(raw.vocab_size);
    expect(modelConfig.nPositions).toBe(raw.n_positions);
    expect(modelConfig.eosTokenId).toBe(raw.eos_token_id);
    expect(modelConfig.dHead * modelConfig.nHead).toBe(modelConfig.nEmbd);
    expect(modelConfig.tieWordEmbeddings).toBe(true);
    expect(activationLabelKey()).toBe('model.activation.gelu_new');
  });

  it.each(['n_layer', 'n_head', 'n_embd', 'vocab_size', 'n_positions'])(
    'rejects a missing, non-integer, zero or negative %s',
    (key) => {
      for (const bad of [undefined, 1.5, '12', 0, -1]) {
        const c = base();
        if (bad === undefined) delete c[key];
        else c[key] = bad;
        expect(() => validateConfig(c)).toThrow(ConfigError);
      }
    },
  );

  it('rejects n_embd not divisible by n_head', () => {
    const c = base();
    c.n_head = (c.n_embd as number) + 1;
    expect(() => validateConfig(c)).toThrow(/divisible/);
  });

  it('falls back to 4 × n_embd when n_inner is null or absent', () => {
    for (const nInner of [null, undefined]) {
      const c = base();
      c.n_inner = nInner;
      expect(validateConfig(c).nInner).toBe(4 * (c.n_embd as number));
    }
    const c = base();
    c.n_inner = 2 * (c.n_embd as number);
    expect(validateConfig(c).nInner).toBe(2 * (c.n_embd as number));
    c.n_inner = 0;
    expect(() => validateConfig(c)).toThrow(ConfigError);
  });

  it('rejects a non-object', () => {
    expect(() => validateConfig(null)).toThrow(ConfigError);
    expect(() => validateConfig('config')).toThrow(ConfigError);
  });
});
