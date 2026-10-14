<!--
  App shell: header (title, language/mode/theme switches), intro, example picker, the flow
  indicator and view navigation, and the current view. Views load lazily and each sits in its
  own error boundary, so one failing view never breaks the others (Principle V).
-->
<script lang="ts">
  import type { Component } from 'svelte';
  import FlowIndicator from './components/FlowIndicator.svelte';
  import ThemeSwitch from './components/ThemeSwitch.svelte';
  import ViewNav from './components/ViewNav.svelte';
  import { t } from './lib/i18n/index';
  import { notices } from './lib/state/notices.svelte';
  import { viewState, type ViewId } from './lib/state/viewState.svelte';

  type ViewModule = { default: Component<{ view: ViewId }> };

  // Each story replaces its placeholder with the real view module here.
  const views: Record<ViewId, () => Promise<ViewModule>> = {
    tokens: () => import('./views/Placeholder.svelte'),
    embeddings: () => import('./views/Placeholder.svelte'),
    blocks: () => import('./views/Placeholder.svelte'),
    attention: () => import('./views/Placeholder.svelte'),
    prediction: () => import('./views/Placeholder.svelte'),
    architecture: () => import('./views/Placeholder.svelte'),
    cost: () => import('./views/Placeholder.svelte'),
    method: () => import('./views/Placeholder.svelte'),
  };

  let attempt = $state(0);
  const current = $derived(viewState.view);
  const loading = $derived.by(() => {
    void attempt; // a retry re-runs the import
    return views[current]();
  });
</script>

<a class="skip-link" href="#main">{t('app.skip_to_content')}</a>

<header class="app-header">
  <div class="container header-inner">
    <h1 class="title">{t('app.title')}</h1>
    <div class="controls">
      <div data-slot="language"></div>
      <div data-slot="mode"></div>
      <ThemeSwitch />
    </div>
  </div>
</header>

<main id="main" class="container" tabindex="-1">
  <section class="intro">
    <p>{t('app.tagline')}</p>
  </section>

  <div data-slot="example-picker"></div>

  <div class="navigation">
    <FlowIndicator {current} />
    <ViewNav {current} onselect={(view) => viewState.setView(view)} />
  </div>

  <div class="view-outlet">
    {#key current}
      <svelte:boundary onerror={(error) => console.error(error)}>
        {#await loading}
          <p class="status" role="status">{t('status.loading')}</p>
        {:then module}
          <module.default view={current} />
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

  .view-error {
    padding: var(--space-4);
    color: var(--color-text);
    background: var(--color-danger-surface);
    border: 1px solid var(--color-danger);
    border-radius: var(--radius-md);
  }

  .view-error button {
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
