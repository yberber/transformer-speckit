// Shareable links (contracts/url-state.md): the view state in the query string, a formula id in
// the fragment. Parsing never fails: anything invalid falls back to a valid value and is listed in
// `replaced`, so the app can say that part of the link could not be restored (US7-3). The
// serializer takes only the shareable fields; there is no way to hand it live text (FR-034).
import { isLocale, type Locale } from '../i18n/index';
import type { Mode, ViewState } from './viewState.svelte';
import { isView } from './views';

/** The URL keys, in the order the contract writes them. */
export const URL_KEYS = ['mode', 'ex', 'view', 'layer', 'head', 'step', 'lang'] as const;
export type UrlKey = (typeof URL_KEYS)[number];

export type ShareableState = Pick<
  ViewState,
  'mode' | 'exampleId' | 'view' | 'layer' | 'head' | 'step' | 'lang'
>;

/** A parsed link. `lang` is set only if the link names a valid one; otherwise precedence decides. */
export type UrlState = Omit<ShareableState, 'lang'> & { lang?: Locale };

export interface UrlContext {
  /** Example ids from index.json, or null while it has not loaded (then see `clampExample`). */
  exampleIds: readonly string[] | null;
  nLayer: number;
  nHead: number;
}

export interface ParsedUrl {
  state: UrlState;
  /** Keys whose value was invalid and replaced, in contract order. */
  replaced: UrlKey[];
}

/** data-model.md "Example": what an example id can look like at all. */
const EXAMPLE_ID = /^[a-z0-9-]{1,40}$/;
const INTEGER = /^-?\d+$/;

/**
 * `search` is `location.search` (with or without "?"); the fragment is not read here. A `step`
 * beyond the run cannot be checked until the example is loaded: apply `clampStep` then.
 */
export function parseUrl(search: string, ctx: UrlContext): ParsedUrl {
  const params = new URLSearchParams(search.split('#')[0]);
  const replaced: UrlKey[] = [];
  const get = (key: UrlKey) => params.get(key);

  let mode: Mode = 'example';
  const rawMode = get('mode');
  if (rawMode === 'live') mode = 'live';
  else if (rawMode !== null && rawMode !== 'example') replaced.push('mode');

  let exampleId: string | null = null;
  if (mode === 'example') {
    const raw = get('ex');
    if (ctx.exampleIds) {
      const clamped = clampExample(raw, ctx.exampleIds);
      exampleId = clamped.exampleId;
      if (clamped.replaced) replaced.push('ex');
    } else if (raw !== null) {
      if (EXAMPLE_ID.test(raw)) exampleId = raw;
      else replaced.push('ex');
    }
  }

  let view: UrlState['view'] = 'tokens';
  const rawView = get('view');
  if (isView(rawView)) view = rawView;
  else if (rawView !== null) replaced.push('view');

  /** An integer in lo..hi: out of range is clamped, anything else is the default (lo). */
  const integer = (key: UrlKey, lo: number, hi: number): number => {
    const raw = get(key);
    if (raw === null) return lo;
    if (!INTEGER.test(raw)) {
      replaced.push(key);
      return lo;
    }
    const n = Number(raw);
    const clamped = Math.min(hi, Math.max(lo, n));
    if (clamped !== n) replaced.push(key);
    return clamped;
  };
  const layer = integer('layer', 1, ctx.nLayer);
  const head = integer('head', 1, ctx.nHead);
  const step = integer('step', 0, Number.MAX_SAFE_INTEGER);

  const state: UrlState = { mode, exampleId, view, layer, head, step };
  const rawLang = get('lang');
  if (isLocale(rawLang)) state.lang = rawLang;
  else if (rawLang !== null) replaced.push('lang');

  return { state, replaced };
}

/** Check an example id from the link once index.json is in; the default is the first example. */
export function clampExample(
  id: string | null,
  exampleIds: readonly string[],
): { exampleId: string; replaced: boolean } {
  if (id !== null && exampleIds.includes(id)) return { exampleId: id, replaced: false };
  return { exampleId: exampleIds[0]!, replaced: id !== null };
}

/** A step from the link, once the run is known: beyond the run means its last step. */
export function clampStep(
  step: number,
  run: { steps: number },
): { step: number; replaced: boolean } {
  const last = Math.max(0, run.steps);
  return step > last ? { step: last, replaced: true } : { step, replaced: false };
}

/**
 * The query string (and fragment) for `state`: keys in contract order, defaults left out except
 * `ex` and `lang`, which are always written so a link reads the same in every browser. `ex` is
 * never written in live mode. The fragment is kept only on the Method view.
 */
export function serializeUrl(state: ShareableState, hash = ''): string {
  const params = new URLSearchParams();
  if (state.mode === 'live') params.set('mode', 'live');
  else if (state.exampleId) params.set('ex', state.exampleId);
  if (state.view !== 'tokens') params.set('view', state.view);
  if (state.layer !== 1) params.set('layer', String(state.layer));
  if (state.head !== 1) params.set('head', String(state.head));
  if (state.step !== 0) params.set('step', String(state.step));
  params.set('lang', state.lang);
  const fragment = state.view === 'method' && hash ? `#${hash.replace(/^#/, '')}` : '';
  return `?${params}${fragment}`;
}
