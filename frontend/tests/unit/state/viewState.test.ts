import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../../../src/lib/i18n/index';
import { modelConfig } from '../../../src/lib/model/config';
import {
  FLOW_VIEWS,
  THEME_STORAGE_KEY,
  VIEWS,
  ViewState,
} from '../../../src/lib/state/viewState.svelte';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

const throwingStorage = {
  getItem: () => {
    throw new DOMException('blocked', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('quota', 'QuotaExceededError');
  },
};

let root: { dataset: Record<string, string> };

beforeEach(() => {
  root = { dataset: {} };
  vi.stubGlobal('document', { documentElement: root });
  vi.stubGlobal('localStorage', memoryStorage());
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await setLocale('en');
});

describe('ViewState', () => {
  it('lists the views with the five flow views first, in flow order', () => {
    expect(VIEWS).toEqual([
      'tokens',
      'embeddings',
      'blocks',
      'attention',
      'prediction',
      'architecture',
      'cost',
      'method',
    ]);
    expect(FLOW_VIEWS).toEqual(VIEWS.slice(0, 5));
  });

  it('clamps layer and head to the model config', () => {
    const s = new ViewState();
    s.setLayer(0);
    expect(s.layer).toBe(1);
    s.setLayer(modelConfig.nLayer + 5);
    expect(s.layer).toBe(modelConfig.nLayer);
    s.setLayer(3.4);
    expect(s.layer).toBe(3);
    s.setLayer(Number.NaN);
    expect(s.layer).toBe(3);
    s.setHead(-2);
    expect(s.head).toBe(1);
    s.setHead(modelConfig.nHead + 1);
    expect(s.head).toBe(modelConfig.nHead);
  });

  it('clamps the step to the current run', () => {
    const s = new ViewState();
    s.setRunSteps(20);
    s.setStep(25);
    expect(s.step).toBe(20);
    s.setStep(-1);
    expect(s.step).toBe(0);
    s.setStep(7);
    s.setRunSteps(5);
    expect(s.step).toBe(5);
  });

  it('accepts only known views and languages', () => {
    const s = new ViewState();
    expect(s.setView('attention')).toBe(true);
    expect(s.setView('nope')).toBe(false);
    expect(s.view).toBe('attention');
    expect(s.setLang('de')).toBe(true);
    expect(s.setLang('fr')).toBe(false);
    expect(s.lang).toBe('de');
    expect(s.setMode('live')).toBe(true);
    expect(s.setMode('other' as never)).toBe(false);
    expect(s.mode).toBe('live');
  });

  it('resets the step but keeps view, layer and head when the example changes', () => {
    const s = new ViewState();
    s.setRunSteps(20);
    s.setView('attention');
    s.setLayer(5);
    s.setHead(3);
    s.setStep(4);
    s.setExample('medium-sun');
    expect(s.exampleId).toBe('medium-sun');
    expect(s.step).toBe(0);
    expect([s.view, s.layer, s.head]).toEqual(['attention', 5, 3]);
  });

  it('restores a link without resetting the step, and clamps it only once the run is known', () => {
    const s = new ViewState();
    s.restore({ view: 'attention', layer: 4, head: 2, step: 7 });
    expect([s.view, s.layer, s.head, s.step]).toEqual(['attention', 4, 2, 7]);
    s.setRunSteps(5);
    expect(s.step).toBe(5);
    s.restore({ view: 'nope' as never, layer: modelConfig.nLayer + 1, head: 0, step: -2 });
    expect([s.view, s.layer, s.head, s.step]).toEqual(['attention', modelConfig.nLayer, 1, 0]);
  });

  it('persists and applies the theme', () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    const s = new ViewState();
    expect(s.theme).toBe('system');
    expect(root.dataset.theme).toBeUndefined();
    s.setTheme('dark');
    expect(storage.data.get(THEME_STORAGE_KEY)).toBe('dark');
    expect(root.dataset.theme).toBe('dark');
    expect(new ViewState().theme).toBe('dark');
    s.setTheme('system');
    expect(root.dataset.theme).toBeUndefined();
    expect(s.setTheme('sepia')).toBe(false);
  });

  it('resolves the shown theme', () => {
    const s = new ViewState();
    // No matchMedia in the node environment: "system" falls back to light.
    expect(s.resolvedTheme).toBe('light');
    s.setTheme('dark');
    expect(s.resolvedTheme).toBe('dark');
    s.setTheme('light');
    expect(s.resolvedTheme).toBe('light');
  });

  it('keeps working when localStorage throws', () => {
    vi.stubGlobal('localStorage', throwingStorage);
    const s = new ViewState();
    expect(s.theme).toBe('system');
    expect(s.setTheme('light')).toBe(true);
    expect(s.theme).toBe('light');
    expect(root.dataset.theme).toBe('light');
  });

  it('ignores an unknown stored theme', () => {
    vi.stubGlobal('localStorage', memoryStorage({ [THEME_STORAGE_KEY]: 'neon' }));
    expect(new ViewState().theme).toBe('system');
  });
});
