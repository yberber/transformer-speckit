import { describe, expect, it } from 'vitest';
import { duration, reducedMotion } from '../../../src/lib/motion';

describe('motion', () => {
  it('keeps durations when reduced motion is not requested', () => {
    // No matchMedia in the node test environment: the fallback is "not reduced".
    expect(reducedMotion.current).toBe(false);
    expect(duration(250)).toBe(250);
  });
});
