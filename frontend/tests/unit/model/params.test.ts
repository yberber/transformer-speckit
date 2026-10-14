// FR-019, SC-003, quickstart Q4: every parameter group computed from the config has the shape
// recorded from the real state_dict, and the counts equal the hand references in gpt2-small.md.
import { describe, expect, it } from 'vitest';
import { modelConfig } from '../../../src/lib/model/config';
import { paramGroups, perBlockParams, totalParams } from '../../../src/lib/model/params';
import { gpt2Small } from '../../reference/gpt2-small';
import paramShapes from '../../reference/param-shapes.json';

const shapes = paramShapes as Record<string, number[]>;
const groups = paramGroups(modelConfig);
const byName = new Map(groups.map((g) => [g.name, g]));
const ref = gpt2Small.params;

/** Sum of the counts of one component's groups in one layer (null = outside the blocks). */
function componentCount(component: string, layer: number | null): number {
  return groups
    .filter((g) => g.component === component && g.layer === layer)
    .reduce((sum, g) => sum + g.count, 0);
}

describe('paramGroups', () => {
  it('has exactly the parameter names of the real state_dict', () => {
    expect(new Set(groups.map((g) => g.name))).toEqual(new Set(Object.keys(shapes)));
    expect(groups).toHaveLength(Object.keys(shapes).length);
  });

  it.each(Object.entries(shapes))('%s has the recorded shape', (name, shape) => {
    expect(byName.get(name)?.shape).toEqual(shape);
  });

  it('counts each group as the product of its shape', () => {
    for (const g of groups) {
      expect(g.count).toBe(g.shape.reduce((a, b) => a * b, 1));
      expect(Number.isSafeInteger(g.count)).toBe(true);
    }
  });

  it('places block groups in layers 1..n_layer and the rest outside', () => {
    for (const g of groups) {
      if (g.name.startsWith('h.')) {
        // HF names count from 0; the UI and `layer` count from 1.
        expect(g.name.startsWith(`h.${g.layer! - 1}.`)).toBe(true);
        expect(g.layer).toBeGreaterThanOrEqual(1);
        expect(g.layer).toBeLessThanOrEqual(modelConfig.nLayer);
      } else {
        expect(g.layer).toBeNull();
      }
      expect(g.formulaId).toBe(`params-${g.component}`);
    }
  });
});

describe('parameter counts', () => {
  it('equals the reference total', () => {
    expect(totalParams(modelConfig)).toBe(ref.total);
  });

  it('equals the per-block, wte, wpe and ln_f references', () => {
    expect(perBlockParams(modelConfig)).toBe(ref.per_block);
    expect(perBlockParams(modelConfig) * modelConfig.nLayer).toBe(ref.all_blocks);
    expect(componentCount('wte', null)).toBe(ref.wte);
    expect(componentCount('wpe', null)).toBe(ref.wpe);
    expect(componentCount('ln_f', null)).toBe(ref.ln_f);
    for (let layer = 1; layer <= modelConfig.nLayer; layer++) {
      for (const [component, count] of Object.entries(ref.block)) {
        expect(componentCount(component, layer), `${component} in layer ${layer}`).toBe(count);
      }
    }
  });

  it('ties the LM head to wte and leaves it out of the total', () => {
    const lmHead = byName.get('lm_head.weight')!;
    expect(lmHead.tiedTo).toBe('wte.weight');
    expect(lmHead.share).toBe(0);
    const counted = groups.filter((g) => g.tiedTo === null);
    expect(counted.reduce((sum, g) => sum + g.count, 0)).toBe(ref.total);
    for (const g of groups) if (g.name !== 'lm_head.weight') expect(g.tiedTo).toBeNull();
  });

  it('gives counted groups shares that sum to 1', () => {
    const sum = groups.filter((g) => g.tiedTo === null).reduce((s, g) => s + g.share, 0);
    expect(Math.abs(sum - 1)).toBeLessThanOrEqual(1e-12);
    for (const g of groups) {
      if (g.tiedTo === null) expect(g.share).toBeCloseTo(g.count / ref.total, 15);
    }
  });
});
