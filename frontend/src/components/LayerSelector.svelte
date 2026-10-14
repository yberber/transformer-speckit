<!--
  Pick a transformer block (FR-016, FR-038): Previous / Next and a direct <select> of layers
  1..nLayer (from the model config), bound to viewState.layer. The "Layer n of N" label is a
  polite live region, so every change is announced.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../lib/i18n/index';
  import { modelConfig } from '../lib/model/config';
  import { viewState } from '../lib/state/viewState.svelte';

  const selectId = $props.id();
  const layers = Array.from({ length: modelConfig.nLayer }, (_, i) => i + 1);
  const layer = $derived(viewState.layer);

  let prevButton: HTMLButtonElement | undefined = $state();
  let nextButton: HTMLButtonElement | undefined = $state();

  /** A button that becomes disabled loses focus; hand it to the other button instead. */
  async function go(to: number, from: HTMLButtonElement | undefined, other?: HTMLButtonElement) {
    const hadFocus = from !== undefined && document.activeElement === from;
    viewState.setLayer(to);
    await tick();
    if (hadFocus && from?.disabled) other?.focus();
  }
</script>

<div class="selector" role="group" aria-label={t('layer.group')} data-layer-selector>
  <button
    type="button"
    data-action="prev-layer"
    disabled={layer <= 1}
    bind:this={prevButton}
    onclick={() => go(layer - 1, prevButton, nextButton)}
  >
    <span aria-hidden="true">←</span>
    {t('layer.previous')}
  </button>

  <span class="label" aria-live="polite" data-layer-label data-layer={layer}>
    {t('layer.label', { n: layer, total: modelConfig.nLayer })}
  </span>

  <label class="visually-hidden" for={selectId}>{t('layer.choose')}</label>
  <select
    id={selectId}
    data-layer-select
    value={layer}
    onchange={(e) => viewState.setLayer(Number(e.currentTarget.value))}
  >
    {#each layers as n (n)}
      <option value={n}>{t('layer.option', { n })}</option>
    {/each}
  </select>

  <button
    type="button"
    data-action="next-layer"
    disabled={layer >= modelConfig.nLayer}
    bind:this={nextButton}
    onclick={() => go(layer + 1, nextButton, prevButton)}
  >
    {t('layer.next')}
    <span aria-hidden="true">→</span>
  </button>
</div>

<style>
  .selector {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
  }

  .label {
    min-width: 7.5rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  button,
  select {
    min-height: 2.75rem;
    padding: var(--space-1) var(--space-3);
    font-weight: 600;
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-accent);
  }

  button:disabled {
    color: var(--color-text-muted);
    background: var(--color-surface-raised);
    border-style: dashed;
    cursor: not-allowed;
  }
</style>
