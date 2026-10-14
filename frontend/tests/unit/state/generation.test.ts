import { describe, expect, it } from 'vitest';
import { canAdvance, detectRepetition, endMessageKey } from '../../../src/lib/state/generation';

/** Token-like objects from a list of IDs (only the ID matters for repetition). */
function toks(...ids: number[]) {
  return ids.map((id) => ({ id, bytes: [0x61] }));
}

describe('canAdvance', () => {
  it('is true iff the step is before the last precomputed step', () => {
    const run = { steps: 3 };
    expect(canAdvance(run, 0)).toBe(true);
    expect(canAdvance(run, 2)).toBe(true);
    expect(canAdvance(run, 3)).toBe(false);
    expect(canAdvance({ steps: 0 }, 0)).toBe(false);
  });
});

describe('endMessageKey', () => {
  it('maps every stop reason to its end message', () => {
    expect(endMessageKey('step_limit')).toBe('example.end.step_limit');
    expect(endMessageKey('eos')).toBe('example.end.eos');
    expect(endMessageKey('context_limit')).toBe('example.end.context_limit');
    expect(endMessageKey('step_limit', 'live')).toBe('live.end.step_limit');
    expect(endMessageKey('eos', 'live')).toBe('live.end.eos');
    expect(endMessageKey('context_limit', 'live')).toBe('live.end.context_limit');
  });
});

describe('detectRepetition', () => {
  it('is false when no three-token sequence repeats', () => {
    expect(detectRepetition(toks(1, 2, 3, 4, 5, 6), 3, 3)).toBe(false);
  });

  it('is false at step 0, even if the input repeats itself', () => {
    expect(detectRepetition(toks(1, 2, 3, 1, 2, 3, 9), 6, 0)).toBe(false);
  });

  it('ignores a repetition that lies entirely in the input', () => {
    // Input repeats 1 2 3; the generated tokens 7 8 repeat nothing.
    expect(detectRepetition(toks(1, 2, 3, 1, 2, 3, 7, 8), 6, 2)).toBe(false);
  });

  it('finds an input sequence repeated by generated tokens', () => {
    expect(detectRepetition(toks(1, 2, 3, 4, 1, 2, 3), 4, 3)).toBe(true);
  });

  it('counts a later occurrence that only partly consists of generated tokens', () => {
    // Input: 1 2 3 9 1 2 — generated: 3. The later "1 2 3" ends on the generated token.
    expect(detectRepetition(toks(1, 2, 3, 9, 1, 2, 3), 6, 1)).toBe(true);
  });

  it('finds a loop made only of generated tokens, including overlapping occurrences', () => {
    expect(detectRepetition(toks(1, 2, 5, 5, 5, 5), 2, 4)).toBe(true);
    expect(detectRepetition(toks(1, 2, 5, 5, 5, 5), 2, 3)).toBe(false);
  });

  it('looks only at the tokens visible at step k', () => {
    const tokens = toks(1, 2, 3, 4, 1, 2, 3);
    expect(detectRepetition(tokens, 4, 2)).toBe(false);
    expect(detectRepetition(tokens, 4, 3)).toBe(true);
  });
});
