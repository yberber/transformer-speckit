<!--
  "Show details" disclosure (FR-032): the main idea first, exact numbers on demand. The content is
  not rendered at all until opened, so closed details cost nothing.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../lib/i18n/index';

  let {
    children,
    open = $bindable(false),
  }: {
    children: Snippet;
    open?: boolean;
  } = $props();

  const id = $props.id();
</script>

<div class="show-details">
  <button
    type="button"
    class="toggle"
    data-show-details
    aria-expanded={open}
    aria-controls={id}
    onclick={() => (open = !open)}
  >
    <span class="chevron" aria-hidden="true"></span>
    {open ? t('details.hide') : t('details.show')}
  </button>
  <div {id} class="content" hidden={!open}>
    {#if open}
      {@render children()}
    {/if}
  </div>
</div>

<style>
  .show-details {
    margin-block: var(--space-3);
  }

  .toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 2.5rem;
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-accent);
    background: transparent;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-pill);
  }

  .toggle:hover {
    background: var(--color-accent-soft);
  }

  .chevron {
    width: 0.5em;
    height: 0.5em;
    border-right: 2px solid currentColor;
    border-bottom: 2px solid currentColor;
    transform: rotate(-45deg);
    transition: transform var(--duration-fast) ease;
  }

  [aria-expanded='true'] .chevron {
    transform: rotate(45deg);
  }

  .content {
    margin-top: var(--space-3);
  }
</style>
