// What the visitor is looking at (data-model.md "ViewState"). Everything here except the theme
// is shareable through the URL (contracts/url-state.md). Live-mode text is deliberately NOT
// part of this class: it must never reach the URL or storage (FR-012, FR-034).
import { MediaQuery } from 'svelte/reactivity';
import { isLocale, setLocale, type Locale } from '../i18n/index';
import { modelConfig } from '../model/config';

export const VIEWS = [
  'tokens',
  'embeddings',
  'blocks',
  'attention',
  'prediction',
  'architecture',
  'cost',
  'method',
] as const;
export type ViewId = (typeof VIEWS)[number];

/** The "inside the machine" views, in the order data flows through the model (FR-021). */
export const FLOW_VIEWS = VIEWS.slice(0, 5) as readonly ViewId[];
export const REFERENCE_VIEWS = VIEWS.slice(5) as readonly ViewId[];

export type Mode = 'example' | 'live';
export type ThemePreference = 'light' | 'dark' | 'system';
export const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export const THEME_STORAGE_KEY = 'itt.theme';

const prefersDark = new MediaQuery('(prefers-color-scheme: dark)', false);

export function isView(v: unknown): v is ViewId {
  return VIEWS.includes(v as ViewId);
}

function clampInt(value: number, lo: number, hi: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.min(hi, Math.max(lo, Math.round(value)));
}

function readStoredTheme(): ThemePreference {
  try {
    const stored = globalThis.localStorage?.getItem(THEME_STORAGE_KEY);
    return THEMES.includes(stored as ThemePreference) ? (stored as ThemePreference) : 'system';
  } catch {
    return 'system';
  }
}

export class ViewState {
  mode: Mode = $state('example');
  exampleId: string | null = $state(null);
  view: ViewId = $state('tokens');
  /** 1-based, as shown in the UI and the URL. */
  layer = $state(1);
  /** 1-based. */
  head = $state(1);
  step = $state(0);
  /** Number of steps of the current run; `step` stays within 0..runSteps. */
  runSteps = $state(0);
  lang: Locale = $state('en');
  theme: ThemePreference = $state('system');

  constructor() {
    this.theme = readStoredTheme();
    this.applyTheme();
  }

  /** The theme actually shown: the system setting when the preference is "system". */
  get resolvedTheme(): 'light' | 'dark' {
    if (this.theme !== 'system') return this.theme;
    return prefersDark.current ? 'dark' : 'light';
  }

  setMode(mode: Mode): boolean {
    if (mode !== 'example' && mode !== 'live') return false;
    this.mode = mode;
    return true;
  }

  /** Select an example: back to step 0, keeping view, layer and head. */
  setExample(id: string): void {
    this.exampleId = id;
    this.step = 0;
  }

  /** Called when a run is loaded; keeps the current step within the run. */
  setRunSteps(steps: number): void {
    this.runSteps = Math.max(0, Math.floor(steps));
    this.step = Math.min(this.step, this.runSteps);
  }

  setView(view: string): boolean {
    if (!isView(view)) return false;
    this.view = view;
    return true;
  }

  setLayer(layer: number): void {
    this.layer = clampInt(layer, 1, modelConfig.nLayer) ?? this.layer;
  }

  setHead(head: number): void {
    this.head = clampInt(head, 1, modelConfig.nHead) ?? this.head;
  }

  setStep(step: number): void {
    this.step = clampInt(step, 0, this.runSteps) ?? this.step;
  }

  setLang(lang: string): boolean {
    if (!isLocale(lang)) return false;
    this.lang = lang;
    void setLocale(lang);
    return true;
  }

  setTheme(theme: string): boolean {
    if (!THEMES.includes(theme as ThemePreference)) return false;
    this.theme = theme as ThemePreference;
    try {
      globalThis.localStorage?.setItem(THEME_STORAGE_KEY, this.theme);
    } catch {
      // Storage can be unavailable (private mode, blocked site data); the theme still applies.
    }
    this.applyTheme();
    return true;
  }

  /** `data-theme` on <html>: absent for "system", so CSS follows prefers-color-scheme. */
  private applyTheme(): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (this.theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = this.theme;
  }
}

export const viewState = new ViewState();
