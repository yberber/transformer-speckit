<!--
  App shell: header (title, language/mode/theme switches), intro, example picker or live mode
  panel, the flow indicator and view navigation, and the current view. Views load lazily and each
  sits in its own error boundary, so one failing view never breaks the others. Live mode is a
  lazily loaded chunk in a boundary of its own: whatever goes wrong there, example mode keeps
  working (Principle V). The address always holds the shareable state (contracts/url-state.md):
  changing view, example or mode adds a history entry, the rest replaces the current one.
-->
<script lang="ts">
  import type { Component } from 'svelte';
  import ExamplePicker from './components/ExamplePicker.svelte';
  import FlowIndicator from './components/FlowIndicator.svelte';
  import GenerationControls from './components/GenerationControls.svelte';
  import IntroNote from './components/IntroNote.svelte';
  import LanguageSwitch from './components/LanguageSwitch.svelte';
  import ModeSwitch from './components/ModeSwitch.svelte';
  import ThemeSwitch from './components/ThemeSwitch.svelte';
  import ViewNav from './components/ViewNav.svelte';
  import {
    loadExample,
    loadIndex,
    type ExampleIndex,
    type ExampleRun,
  } from './lib/data/exampleSource';
  import type { RunData } from './lib/data/runData';
  import { t } from './lib/i18n/index';
  import { limits } from './lib/limits';
  import { modelConfig } from './lib/model/config';
  import { notices, raiseLinkNotice } from './lib/state/notices.svelte';
  import {
    clampExample,
    clampStep,
    parseUrl,
    serializeUrl,
    type ShareableState,
  } from './lib/state/url';
  import { viewState, type Mode, type ViewId } from './lib/state/viewState.svelte';
  import type { ViewProps } from './views/types';

  let {
    linkExample = null,
  }: {
    /** The example named by the address at startup, not yet checked against index.json. */
    linkExample?: string | null;
  } = $props();

  type ViewModule = { default: Component<ViewProps> };

  // One module per view, loaded when the view is first shown.
  const views: Record<ViewId, () => Promise<ViewModule>> = {
    tokens: () => import('./views/Tokens.svelte'),
    embeddings: () => import('./views/Embeddings.svelte'),
    blocks: () => import('./views/Blocks.svelte'),
    attention: () => import('./views/Attention.svelte'),
    prediction: () => import('./views/Prediction.svelte'),
    architecture: () => import('./views/Architecture.svelte'),
    cost: () => import('./views/Cost.svelte'),
    method: () => import('./views/Method.svelte'),
  };

  /** Views that show a run, and so the generation controls; the others need only the config. */
  const RUN_VIEWS: readonly ViewId[] = [
    'tokens',
    'embeddings',
    'blocks',
    'attention',
    'prediction',
    'cost',
  ];

  /** Live mode exists only in builds that name an API (Principle V: the site works without). */
  const liveAvailable = Boolean(import.meta.env.VITE_API_BASE_URL);

  // A link to live mode in a build without it opens example mode.
  if (viewState.mode === 'live' && !liveAvailable) {
    viewState.setMode('example');
    raiseLinkNotice();
  }

  let attempt = $state(0);
  const current = $derived(viewState.view);
  const loading = $derived.by(() => {
    void attempt; // a retry re-runs the import
    return views[current]();
  });

  // --- example data -----------------------------------------------------------------------

  let index = $state.raw<ExampleIndex | null>(null);
  let indexFailed = $state(false);
  let loaded = $state.raw<{ id: string; run: ExampleRun } | null>(null);
  /** ID of the example whose data failed to load; only that example is affected. */
  let failedId = $state<string | null>(null);
  let reload = $state(0);
  /** The step from the link is checked against the first run that loads. */
  let linkStepPending = true;
  /** Input token counts for the picker, filled in as examples load. */
  const tokenCounts: Record<string, number> = $state({});

  async function startExamples(): Promise<void> {
    indexFailed = false;
    try {
      index = await loadIndex();
    } catch {
      indexFailed = true;
      return;
    }
    const ids = index.examples.map((e) => e.id);
    if (!viewState.exampleId) {
      // The example from the link, or the first one. Set directly: the link's step stays.
      const { exampleId, replaced } = clampExample(linkExample, ids);
      viewState.exampleId = exampleId;
      if (replaced) raiseLinkNotice();
    } else if (!ids.includes(viewState.exampleId)) {
      viewState.setExample(ids[0]!);
    }
  }
  void startExamples();

  $effect(() => {
    const id = viewState.exampleId;
    void reload;
    if (!id || !index) return;
    let cancelled = false;
    failedId = null;
    loadExample(id).then(
      (run) => {
        if (cancelled) return;
        loaded = { id, run };
        tokenCounts[id] = run.nInput;
        // In live mode the steps come from the live run (onLiveRun).
        if (viewState.mode === 'example') {
          if (linkStepPending && clampStep(viewState.step, run).replaced) raiseLinkNotice();
          viewState.setRunSteps(run.steps);
        }
        linkStepPending = false;
        prefetchOthers();
      },
      () => {
        if (!cancelled) failedId = id;
      },
    );
    return () => {
      cancelled = true;
    };
  });

  let prefetched = false;

  /**
   * After the first example is on screen, load the other examples' core.json while the browser
   * is idle: the picker can then show every token count, and switching is instant. Failures are
   * ignored here; they show up only if the visitor picks that example.
   */
  function prefetchOthers(): void {
    if (prefetched || !index) return;
    prefetched = true;
    const ids = index.examples.map((e) => e.id);
    const idle = globalThis.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200));
    idle(() => {
      for (const id of ids) {
        loadExample(id).then(
          (run) => (tokenCounts[id] = run.nInput),
          () => {},
        );
      }
    });
  }

  const exampleRun = $derived(loaded && loaded.id === viewState.exampleId ? loaded.run : null);

  // --- live mode ----------------------------------------------------------------------------

  type LiveModeModule = typeof import('./components/live/LiveMode.svelte');
  let liveModule: Promise<LiveModeModule> | null = null;

  /** The live mode chunk, loaded on first use; a failed load can be retried. */
  function loadLiveMode(): Promise<LiveModeModule> {
    liveModule ??= import('./components/live/LiveMode.svelte').catch((e: unknown) => {
      liveModule = null;
      throw e;
    });
    return liveModule;
  }

  /** The current live run; it exists only in memory and only while live mode is on. */
  let liveRun = $state.raw<RunData | null>(null);
  /** "Continue in live mode": the example text to run, and the step to stay at. */
  let continueFrom = $state.raw<{ text: string; step: number } | null>(null);

  function setMode(mode: Mode): void {
    if (mode === viewState.mode || (mode === 'live' && !liveAvailable)) return;
    viewState.setMode(mode);
    // Leaving live mode discards the live run (the panel discards the text as it closes).
    liveRun = null;
    if (mode === 'example') {
      continueFrom = null;
      viewState.setRunSteps(exampleRun?.steps ?? 0);
    }
  }

  function onLiveRun(next: RunData | null): void {
    if (next === liveRun) return;
    liveRun = next;
    if (next) {
      viewState.setRunSteps(next.steps);
      // After "Continue in live mode" the visitor stays at the step they reached.
      viewState.setStep(continueFrom?.step ?? 0);
      continueFrom = null;
    }
  }

  /** At the last step of an example: run the same text in live mode, up to the live limit. */
  function continueInLive(): void {
    if (!exampleRun) return;
    continueFrom = { text: exampleRun.example.text, step: viewState.step };
    setMode('live');
  }

  // --- shareable address (contracts/url-state.md) -------------------------------------------

  /** The state last written to (or read from) the address. */
  let shown: (ShareableState & { checked: boolean }) | null = null;

  $effect(() => {
    const state: ShareableState = {
      mode: viewState.mode,
      // Until index.json is in, the link's example stays in the address unchecked.
      exampleId: viewState.exampleId ?? linkExample,
      view: viewState.view,
      layer: viewState.layer,
      head: viewState.head,
      step: viewState.step,
      lang: viewState.lang,
    };
    const checked = viewState.exampleId !== null;
    const next = serializeUrl(state, location.hash);
    const prev = shown;
    shown = { ...state, checked };
    if (next === location.search + location.hash) return;
    // The first write normalizes the link; replacing an unchecked example is a correction too.
    const push =
      prev !== null &&
      (prev.view !== state.view ||
        prev.mode !== state.mode ||
        (prev.checked && prev.exampleId !== state.exampleId));
    try {
      if (push) history.pushState(null, '', next);
      else history.replaceState(null, '', next);
    } catch {
      // Browsers limit how often the address may change (e.g. while stepping fast); the next
      // change writes it again.
    }
  });

  /** Back and Forward: show the state of that address. */
  function onPopState(): void {
    const { state } = parseUrl(location.search, {
      exampleIds: index?.examples.map((e) => e.id) ?? null,
      nLayer: modelConfig.nLayer,
      nHead: modelConfig.nHead,
    });
    setMode(state.mode);
    if (state.exampleId !== null && state.exampleId !== viewState.exampleId) {
      viewState.exampleId = state.exampleId;
    }
    viewState.restore(state);
    if (state.lang && state.lang !== viewState.lang) viewState.setLang(state.lang);
  }

  const live = $derived(liveAvailable && viewState.mode === 'live');
  const run = $derived(live ? liveRun : exampleRun);
  const needsRun = $derived(RUN_VIEWS.includes(current));
</script>

{#snippet liveOffer()}
  <div class="live-offer" data-live-offer>
    <p>{t('live.continue_hint', { steps: limits.max_new_tokens })}</p>
    <button type="button" onclick={continueInLive} data-action="continue-live">
      {t('live.continue')}
    </button>
  </div>
{/snippet}

{#snippet liveFailed()}
  <div class="load-error" role="alert" data-live-load-error>
    <p>{t('live.load_failed')}</p>
    <button type="button" onclick={() => setMode('example')}>{t('live.back_to_examples')}</button>
  </div>
{/snippet}

<svelte:window onpopstate={onPopState} />

<div class="app" data-app data-mode={viewState.mode}>
  <a class="skip-link" href="#main">{t('app.skip_to_content')}</a>

  <header class="app-header">
    <div class="container header-inner">
      <h1 class="title">{t('app.title')}</h1>
      <div class="controls">
        <LanguageSwitch />
        {#if liveAvailable}
          <ModeSwitch mode={viewState.mode} onselect={setMode} />
        {/if}
        <ThemeSwitch />
      </div>
    </div>
  </header>

  <main id="main" class="container" tabindex="-1">
    <section class="intro">
      <p>{t('app.tagline')}</p>
      <IntroNote />
    </section>

    {#if live}
      <svelte:boundary>
        {#await loadLiveMode()}
          <p class="status" role="status">{t('status.loading')}</p>
        {:then module}
          <module.default
            onrun={onLiveRun}
            onbacktoexamples={() => setMode('example')}
            startText={continueFrom?.text ?? null}
          />
        {:catch}
          {@render liveFailed()}
        {/await}

        {#snippet failed()}
          {@render liveFailed()}
        {/snippet}
      </svelte:boundary>
    {:else if indexFailed}
      <div class="load-error" role="alert" data-index-error>
        <p>{t('error.index_load')}</p>
        <button type="button" onclick={startExamples}>{t('action.retry')}</button>
      </div>
    {:else}
      <ExamplePicker examples={index?.examples ?? null} {tokenCounts} />
    {/if}

    <div class="navigation">
      <FlowIndicator {current} />
      <ViewNav {current} onselect={(view) => viewState.setView(view)} />
    </div>

    {#if needsRun}
      {#if live}
        {#if liveRun}
          <GenerationControls run={liveRun} />
        {:else}
          <p class="live-empty" data-live-empty>{t('live.empty')}</p>
        {/if}
      {:else if failedId !== null && failedId === viewState.exampleId}
        <div class="load-error" role="alert" data-example-error>
          <p>{t('error.example_load')}</p>
          <button type="button" onclick={() => reload++}>{t('action.retry')}</button>
        </div>
      {:else if !indexFailed}
        <!-- Shown while the run loads too, at its final size, so the view below does not move. -->
        <GenerationControls {run} liveOffer={liveAvailable ? liveOffer : undefined} />
      {/if}
    {/if}

    <div class="view-outlet">
      {#key current}
        <svelte:boundary onerror={(error) => console.error(error)}>
          {#await loading}
            <p class="status" role="status">{t('status.loading')}</p>
          {:then module}
            <module.default view={current} {run} step={viewState.step} />
          {:catch}
            <div class="view-error" role="alert">
              <p>{t('error.view_failed')}</p>
              <button type="button" onclick={() => attempt++}>{t('action.retry')}</button>
            </div>
          {/await}

          {#snippet failed(_error, reset)}
            <div class="view-error" role="alert">
              <p>{t('error.view_failed')}</p>
              <button type="button" onclick={reset}>{t('action.retry')}</button>
            </div>
          {/snippet}
        </svelte:boundary>
      {/key}
    </div>
  </main>

  <div class="notices" role="status" aria-live="polite" aria-label={t('notices.label')}>
    {#each notices as notice (notice.id)}
      <p class="notice">{notice.message}</p>
    {/each}
  </div>
</div>

<style>
  .app-header {
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
  }

  .header-inner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding-block: var(--space-3);
  }

  .title {
    margin: 0;
    font-size: var(--text-xl);
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }

  main {
    padding-block: var(--space-5) var(--space-7);
  }

  main:focus {
    outline: none;
  }

  .intro p {
    max-width: 65ch;
    font-size: var(--text-lg);
  }

  .navigation {
    display: grid;
    gap: var(--space-4);
    margin-block: var(--space-4) var(--space-6);
  }

  .view-outlet {
    min-width: 0;
  }

  .view-error,
  .load-error {
    padding: var(--space-4);
    color: var(--color-text);
    background: var(--color-danger-surface);
    border: 1px solid var(--color-danger);
    border-radius: var(--radius-md);
  }

  .load-error {
    margin-block: var(--space-3);
  }

  .live-offer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin-top: var(--space-3);
  }

  .live-offer p {
    margin: 0;
  }

  .live-offer button {
    min-height: 2.5rem;
    padding: var(--space-1) var(--space-4);
    font-weight: 700;
    color: var(--color-accent-contrast);
    background: var(--color-accent);
    border: 0;
    border-radius: var(--radius-pill);
  }

  .live-empty {
    margin-block: var(--space-4);
    padding: var(--space-3) var(--space-4);
    color: var(--color-text-muted);
    background: var(--color-surface);
    border: 1px dashed var(--color-border-strong);
    border-radius: var(--radius-lg);
  }

  .load-error p {
    margin: 0 0 var(--space-3);
  }

  .view-error button,
  .load-error button {
    min-height: 2.5rem;
    padding: var(--space-1) var(--space-4);
    font-weight: 600;
    color: var(--color-accent-contrast);
    background: var(--color-accent);
    border: 0;
    border-radius: var(--radius-pill);
  }

  .notices {
    position: fixed;
    inset-inline: var(--gutter);
    bottom: var(--space-4);
    z-index: 50;
    display: grid;
    justify-items: center;
    gap: var(--space-2);
    pointer-events: none;
  }

  .notice {
    max-width: 40rem;
    margin: 0;
    padding: var(--space-3) var(--space-4);
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-panel);
    pointer-events: auto;
  }
</style>
