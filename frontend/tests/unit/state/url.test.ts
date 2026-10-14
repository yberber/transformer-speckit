// US7, SC-010, contracts/url-state.md: shareable links round-trip exactly, keys come in contract
// order, invalid parts fall back to valid values (and say so), and live text never gets in.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '../../../src/lib/i18n/index';
import { modelConfig } from '../../../src/lib/model/config';
import {
  clampExample,
  clampStep,
  parseUrl,
  serializeUrl,
  type ShareableState,
} from '../../../src/lib/state/url';
import { VIEWS } from '../../../src/lib/state/views';

const EXAMPLES = new URL('../../../public/data/examples/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', EXAMPLES), 'utf-8')) as {
  examples: { id: string; core: string }[];
};
const exampleIds = index.examples.map((e) => e.id);
const stepsOf = Object.fromEntries(
  index.examples.map((e) => {
    const core = JSON.parse(readFileSync(new URL(e.core, EXAMPLES), 'utf-8')) as {
      run: { steps: number };
    };
    return [e.id, core.run.steps];
  }),
);

const { nLayer, nHead } = modelConfig;
const ctx = { exampleIds, nLayer, nHead };

const base: ShareableState = {
  mode: 'example',
  exampleId: exampleIds[0]!,
  view: 'tokens',
  layer: 1,
  head: 1,
  step: 0,
  lang: 'en',
};

const keysOf = (url: string) => [...new URLSearchParams(url.split('#')[0]).keys()];

describe('round trip (SC-010)', () => {
  it('parse(serialize(state)) == state over example × view × layer × head × step × lang', () => {
    let cases = 0;
    for (const exampleId of exampleIds) {
      for (const view of ['tokens', 'attention', 'cost', 'method'] as const) {
        for (const layer of [1, nLayer]) {
          for (const head of [1, nHead]) {
            for (const step of [0, stepsOf[exampleId]!]) {
              for (const lang of LOCALES) {
                const state: ShareableState = {
                  mode: 'example',
                  exampleId,
                  view,
                  layer,
                  head,
                  step,
                  lang,
                };
                const url = serializeUrl(state);
                const parsed = parseUrl(url, ctx);
                expect(parsed.state, url).toEqual(state);
                expect(parsed.replaced, url).toEqual([]);
                expect(clampStep(step, { steps: stepsOf[exampleId]! })).toEqual({
                  step,
                  replaced: false,
                });
                cases++;
              }
            }
          }
        }
      }
    }
    expect(cases).toBe(exampleIds.length * 4 * 2 * 2 * 2 * LOCALES.length);
  });

  it('round-trips every view', () => {
    for (const view of VIEWS) {
      const state = { ...base, view, layer: 2, head: 3, step: 4, lang: 'tr' } as const;
      expect(parseUrl(serializeUrl(state), ctx).state).toEqual(state);
    }
  });

  it('round-trips live mode, which has no example', () => {
    const state: ShareableState = { ...base, mode: 'live', exampleId: null, view: 'attention' };
    const url = serializeUrl(state);
    expect(parseUrl(url, ctx)).toEqual({ state, replaced: [] });
  });
});

describe('serialization', () => {
  it('writes the keys in contract order', () => {
    const url = serializeUrl({
      mode: 'live',
      exampleId: null,
      view: 'blocks',
      layer: 4,
      head: 5,
      step: 6,
      lang: 'de',
    });
    expect(url).toBe('?mode=live&view=blocks&layer=4&head=5&step=6&lang=de');
    const full = serializeUrl({ ...base, exampleId: exampleIds[3]!, view: 'cost', layer: 2 });
    expect(full).toBe(`?ex=${exampleIds[3]}&view=cost&layer=2&lang=en`);
  });

  it('always writes ex and lang, and leaves out the other defaults', () => {
    const url = serializeUrl(base);
    expect(url).toBe(`?ex=${exampleIds[0]}&lang=en`);
    expect(keysOf(url)).toEqual(['ex', 'lang']);
  });

  it('keeps the order for every combination of non-default keys', () => {
    const order = ['mode', 'ex', 'view', 'layer', 'head', 'step', 'lang'];
    const url = serializeUrl({ ...base, view: 'attention', layer: 5, head: 3, step: 3 });
    const keys = keysOf(url);
    expect(keys).toEqual(order.filter((k) => keys.includes(k)));
  });

  it('adds the fragment only on the Method view', () => {
    expect(serializeUrl({ ...base, view: 'method' }, '#decode-flops')).toBe(
      `?ex=${exampleIds[0]}&view=method&lang=en#decode-flops`,
    );
    expect(serializeUrl({ ...base, view: 'method' }, 'decode-flops')).toMatch(/#decode-flops$/);
    expect(serializeUrl({ ...base, view: 'cost' }, '#decode-flops')).not.toContain('#');
    expect(serializeUrl({ ...base, view: 'method' }, '')).not.toContain('#');
  });
});

describe('normalization', () => {
  it('ignores unknown keys', () => {
    const { state, replaced } = parseUrl(
      `?utm_source=mail&ex=${exampleIds[1]}&foo=bar&view=cost`,
      ctx,
    );
    expect(state).toEqual({ ...base, exampleId: exampleIds[1], view: 'cost', lang: undefined });
    expect(replaced).toEqual([]);
  });

  it('fills in the defaults for missing keys; lang is left to the precedence rules', () => {
    const { state, replaced } = parseUrl('', ctx);
    expect(state).toEqual({ ...base, lang: undefined });
    expect(state).not.toHaveProperty('lang', expect.anything());
    expect(replaced).toEqual([]);
  });

  it('replaces an unknown example, view or language with the default', () => {
    expect(parseUrl('?ex=no-such-text', ctx)).toEqual({
      state: { ...base, lang: undefined },
      replaced: ['ex'],
    });
    expect(parseUrl('?view=nope', ctx)).toEqual({
      state: { ...base, lang: undefined },
      replaced: ['view'],
    });
    expect(parseUrl('?lang=fr', ctx)).toEqual({
      state: { ...base, lang: undefined },
      replaced: ['lang'],
    });
    expect(parseUrl('?mode=demo', ctx).state.mode).toBe('example');
    expect(parseUrl('?mode=demo', ctx).replaced).toEqual(['mode']);
  });

  it('clamps layer and head to the nearest valid value', () => {
    expect(parseUrl('?layer=99', ctx)).toMatchObject({
      state: { layer: nLayer },
      replaced: ['layer'],
    });
    expect(parseUrl('?layer=0', ctx)).toMatchObject({ state: { layer: 1 }, replaced: ['layer'] });
    expect(parseUrl('?head=0', ctx)).toMatchObject({ state: { head: 1 }, replaced: ['head'] });
    expect(parseUrl(`?head=${nHead + 1}`, ctx)).toMatchObject({
      state: { head: nHead },
      replaced: ['head'],
    });
    expect(parseUrl('?head=-3', ctx)).toMatchObject({ state: { head: 1 }, replaced: ['head'] });
  });

  it('replaces non-integers with the default', () => {
    expect(parseUrl('?step=abc', ctx)).toMatchObject({ state: { step: 0 }, replaced: ['step'] });
    expect(parseUrl('?layer=2.5', ctx)).toMatchObject({
      state: { layer: 1 },
      replaced: ['layer'],
    });
    expect(parseUrl('?head=', ctx)).toMatchObject({ state: { head: 1 }, replaced: ['head'] });
    expect(parseUrl('?step=1e3', ctx)).toMatchObject({ state: { step: 0 }, replaced: ['step'] });
    expect(parseUrl('?step=-1', ctx)).toMatchObject({ state: { step: 0 }, replaced: ['step'] });
  });

  it('keeps a step beyond the run until the run is known, then clamps it to the last step', () => {
    const { state, replaced } = parseUrl(`?ex=${exampleIds[0]}&step=999`, ctx);
    expect(state.step).toBe(999);
    expect(replaced).toEqual([]);
    const steps = stepsOf[exampleIds[0]!]!;
    expect(clampStep(state.step, { steps })).toEqual({ step: steps, replaced: true });
    expect(clampStep(steps, { steps })).toEqual({ step: steps, replaced: false });
    expect(clampStep(0, { steps })).toEqual({ step: 0, replaced: false });
  });

  it('lists every replacement, in contract order', () => {
    const { state, replaced } = parseUrl(
      '?lang=xx&step=abc&head=0&layer=99&view=nope&ex=missing&mode=demo',
      ctx,
    );
    expect(replaced).toEqual(['mode', 'ex', 'view', 'layer', 'head', 'step', 'lang']);
    expect(state).toEqual({
      mode: 'example',
      exampleId: exampleIds[0],
      view: 'tokens',
      layer: nLayer,
      head: 1,
      step: 0,
      lang: undefined,
    });
  });

  it('reads the query with or without the leading "?", and ignores the fragment', () => {
    const a = parseUrl(`ex=${exampleIds[2]}&view=method`, ctx);
    const b = parseUrl(`?ex=${exampleIds[2]}&view=method`, ctx);
    expect(a).toEqual(b);
    expect(a.state.exampleId).toBe(exampleIds[2]);
  });
});

describe('examples not known yet', () => {
  const early = { exampleIds: null, nLayer, nHead };

  it('keeps a well-formed example id for later and leaves a missing one empty', () => {
    expect(parseUrl('?ex=long-lighthouse', early).state.exampleId).toBe('long-lighthouse');
    expect(parseUrl('?ex=whatever-id', early).replaced).toEqual([]);
    expect(parseUrl('', early).state.exampleId).toBeNull();
  });

  it('rejects an id that can never be an example', () => {
    expect(parseUrl('?ex=Not%20An%20Id', early)).toMatchObject({
      state: { exampleId: null },
      replaced: ['ex'],
    });
  });

  it('checks the id once the examples are known', () => {
    expect(clampExample('long-lighthouse', exampleIds)).toEqual({
      exampleId: 'long-lighthouse',
      replaced: false,
    });
    expect(clampExample('whatever-id', exampleIds)).toEqual({
      exampleId: exampleIds[0],
      replaced: true,
    });
    expect(clampExample(null, exampleIds)).toEqual({ exampleId: exampleIds[0], replaced: false });
  });
});

describe('live mode (FR-034)', () => {
  it('ignores ex', () => {
    const { state, replaced } = parseUrl(`?mode=live&ex=${exampleIds[2]}&view=attention`, ctx);
    expect(state.mode).toBe('live');
    expect(state.exampleId).toBeNull();
    expect(replaced).toEqual([]);
    expect(parseUrl('?mode=live&ex=missing', ctx).replaced).toEqual([]);
  });

  it('never writes ex in live mode', () => {
    const url = serializeUrl({ ...base, mode: 'live', exampleId: exampleIds[2]! });
    expect(keysOf(url)).toEqual(['mode', 'lang']);
  });

  it('has no parameter that accepts text', () => {
    // The state and an optional fragment, nothing else.
    expect(serializeUrl.length).toBeLessThanOrEqual(2);
    const withText = { ...base, mode: 'live', text: 'my secret text', liveText: 'secret' };
    const url = serializeUrl(withText as unknown as ShareableState);
    expect(url).not.toContain('secret');
    expect(keysOf(url)).toEqual(['mode', 'lang']);
  });
});
