<!--
  Pick an attention head (FR-017, FR-038): Previous / Next and a direct <select> of heads
  1..nHead (from the model config), bound to viewState.head. The "Head n of N" label is a polite
  live region, so every change is announced.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../lib/i18n/index';
  import { modelConfig } from '../lib/model/config';
  import { viewState } from '../lib/state/viewState.svelte';

  const selectId = $props.id();
  const heads = Array.from({ length: modelConfig.nHead }, (_, i) => i + 1);
  const head = $derived(viewState.head);

  let prevButton: HTMLButtonElement | undefined = $state();
  let nextButton: HTMLButtonElement | undefined = $state();

  /** A button that becomes disabled loses focus; hand it to the other button instead. */
  async function go(to: number, from: HTMLButtonElement | undefined, other?: HTMLButtonElement) {
    const hadFocus = from !== undefined && document.activeElement === from;
    viewState.setHead(to);
    await tick();
    if (hadFocus && from?.disabled) other?.focus();
  }
</script>

<div class="selector" role="group" aria-label={t('head.group')} data-head-selector>
  <button
    type="button"
    data-action="prev-head"
    disabled={head <= 1}
    bind:this={prevButton}
    onclick={() => go(head - 1, prevButton, nextButton)}
  >
    <span aria-hidden="true">←</span>
    {t('head.previous')}
  </button>

  <span class="label" aria-live="polite" data-head-label data-head={head}>
    {t('head.label', { n: head, total: modelConfig.nHead })}
  </span>

  <label class="visually-hidden" for={selectId}>{t('head.choose')}</label>
  <select
    id={selectId}
    data-head-select
    value={head}
    onchange={(e) => viewState.setHead(Number(e.currentTarget.value))}
  >
    {#each heads as n (n)}
      <option value={n}>{t('head.option', { n })}</option>
    {/each}
  </select>

  <button
    type="button"
    data-action="next-head"
    disabled={head >= modelConfig.nHead}
    bind:this={nextButton}
    onclick={() => go(head + 1, nextButton, prevButton)}
  >
    {t('head.next')}
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
