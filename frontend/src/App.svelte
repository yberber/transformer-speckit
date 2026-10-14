<!--
  App shell: header (title, language/mode/theme switches), intro, example picker, the flow
  indicator and view navigation, and the current view. Views load lazily and each sits in its
  own error boundary, so one failing view never breaks the others (Principle V).
-->
<script lang="ts">
  import type { Component } from 'svelte';
  import ExamplePicker from './components/ExamplePicker.svelte';
  import FlowIndicator from './components/FlowIndicator.svelte';
  import GenerationControls from './components/GenerationControls.svelte';
  import IntroNote from './components/IntroNote.svelte';
  import LanguageSwitch from './components/LanguageSwitch.svelte';
  import ThemeSwitch from './components/ThemeSwitch.svelte';
  import ViewNav from './components/ViewNav.svelte';
  import {
    loadExample,
    loadIndex,
    type ExampleIndex,
    type ExampleRun,
  } from './lib/data/exampleSource';
  import { t } from './lib/i18n/index';
  import { notices } from './lib/state/notices.svelte';
  import { viewState, type ViewId } from './lib/state/viewState.svelte';
  import type { ViewProps } from './views/types';

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
    if (!viewState.exampleId || !ids.includes(viewState.exampleId)) {
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
        viewState.setRunSteps(run.steps);
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

  const run = $derived(loaded && loaded.id === viewState.exampleId ? loaded.run : null);
  const needsRun = $derived(RUN_VIEWS.includes(current));
</script>

<div class="app" data-app data-mode={viewState.mode}>
  <a class="skip-link" href="#main">{t('app.skip_to_content')}</a>

  <header class="app-header">
    <div class="container header-inner">
      <h1 class="title">{t('app.title')}</h1>
      <div class="controls">
        <LanguageSwitch />
        {#if liveAvailable}
          <div data-slot="mode"></div>
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

    {#if indexFailed}
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
      {#if failedId !== null && failedId === viewState.exampleId}
        <div class="load-error" role="alert" data-example-error>
          <p>{t('error.example_load')}</p>
          <button type="button" onclick={() => reload++}>{t('action.retry')}</button>
        </div>
      {:else if !indexFailed}
        <!-- Shown while the run loads too, at its final size, so the view below does not move. -->
        <GenerationControls {run} />
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

  .controls > div:empty {
    display: none;
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
