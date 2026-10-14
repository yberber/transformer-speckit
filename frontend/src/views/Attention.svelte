<!--
  Attention (FR-017, US2-4/5/6): pick any layer and any head and see, for every token up to the
  current step, how much it looks at each earlier token. A layer's attention file loads the first
  time that layer is shown. Focusing or hovering a cell highlights both tokens in the text above.
-->
<script lang="ts">
  import HeadSelector from '../components/HeadSelector.svelte';
  import Heatmap from '../components/Heatmap.svelte';
  import LayerSelector from '../components/LayerSelector.svelte';
  import Term from '../components/Term.svelte';
  import { createTermRegistry } from '../components/termRegistry';
  import TokenSequence from '../components/TokenSequence.svelte';
  import ViewIntro from '../components/ViewIntro.svelte';
  import { attentionAt, tokensAt } from '../lib/data/runData';
  import { t } from '../lib/i18n/index';
  import { viewState } from '../lib/state/viewState.svelte';
  import type { ViewProps } from './types';

  let { view, run, step }: ViewProps = $props();

  createTermRegistry();
  const headingId = $props.id();

  const layer = $derived(viewState.layer);
  const head = $derived(viewState.head);

  /** All heads of the shown layer, for the full run. */
  let loaded = $state.raw<{ layer: number; heads: Float32Array[] } | null>(null);
  let failed = $state(false);
  let attempt = $state(0);

  $effect(() => {
    void attempt;
    const l = layer;
    if (!run) return;
    let cancelled = false;
    failed = false;
    run.getAttention(l).then(
      (heads) => {
        if (!cancelled) loaded = { layer: l, heads };
      },
      (error) => {
        console.error(error);
        if (!cancelled) failed = true;
      },
    );
    return () => {
      cancelled = true;
    };
  });

  const weights = $derived(
    run && loaded && loaded.layer === layer
      ? attentionAt(run, loaded.heads, step)[head - 1]!
      : null,
  );
  const tokens = $derived(run ? tokensAt(run, step) : []);

  let highlight = $state<number[]>([]);
</script>

<section class="view" data-view={view} aria-labelledby={headingId}>
  <ViewIntro {view} {headingId} />

  <ul class="terms">
    <li><Term id="attention" /></li>
    <li><Term id="head" /></li>
  </ul>
  <p class="masking" data-masking-note>{t('attention.masking')}</p>

  <div class="selectors">
    <LayerSelector />
    <HeadSelector />
  </div>

  {#if run}
    <div class="panel sequence">
      <h3 class="panel-title">{t('attention.sequence')}</h3>
      <TokenSequence
        {run}
        {step}
        theme={viewState.resolvedTheme}
        {highlight}
        label={t('attention.sequence')}
      />
    </div>

    <div class="panel map">
      {#if failed}
        <div class="load-error" role="alert" data-attention-error>
          <p>{t('attention.load_error')}</p>
          <button type="button" onclick={() => attempt++}>{t('action.retry')}</button>
        </div>
      {:else if !weights}
        <p class="status" role="status">{t('status.loading')}</p>
      {:else}
        <Heatmap
          {weights}
          {tokens}
          nInput={run.nInput}
          theme={viewState.resolvedTheme}
          label={t('attention.grid_label', { layer, head })}
          onhighlight={(pair) => (highlight = pair ? [...new Set(pair)] : [])}
        />
      {/if}
    </div>
  {/if}
</section>

<style>
  .terms {
    display: grid;
    gap: var(--space-2);
    max-width: 65ch;
    margin: 0 0 var(--space-3);
    padding: 0;
    list-style: none;
  }

  .masking {
    max-width: 65ch;
    margin-bottom: var(--space-4);
  }

  .selectors {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3) var(--space-6);
    margin-bottom: var(--space-4);
  }

  .sequence,
  .map {
    padding: var(--space-4);
  }

  .sequence {
    margin-bottom: var(--space-4);
  }

  .panel-title {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-panel-muted);
  }

  .map {
    min-height: 12rem;
  }

  .status {
    margin: 0;
  }

  .load-error {
    padding: var(--space-4);
    color: var(--color-text);
    background: var(--color-danger-surface);
    border: 1px solid var(--color-danger);
    border-radius: var(--radius-md);
  }

  .load-error button {
    min-height: 2.5rem;
    padding: var(--space-1) var(--space-4);
    font-weight: 600;
    color: var(--color-accent-contrast);
    background: var(--color-accent);
    border: 0;
    border-radius: var(--radius-pill);
  }
</style>
