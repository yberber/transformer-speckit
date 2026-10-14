<!--
  The tokens visible at a step (positions 0 .. nInput + step − 1) as wrapping chips. Used by the
  Tokens, Embeddings, Blocks, Attention and Prediction views. With a focus or hover callback the
  chips become buttons, so they are reachable with the keyboard (FR-038).
-->
<script lang="ts">
  import { tokensAt, type RunData } from '../lib/data/runData';
  import type { Theme } from '../lib/tokens/palette';
  import TokenChip from './TokenChip.svelte';

  let {
    run,
    step,
    theme,
    highlight = [],
    label,
    onfocustoken,
    onhovertoken,
  }: {
    run: RunData;
    step: number;
    theme: Theme;
    /** 0-based positions to highlight. */
    highlight?: number[];
    /** Accessible name of the list. */
    label?: string;
    /** Called with a position on focus or click, and with null when focus leaves. */
    onfocustoken?: (position: number | null) => void;
    /** Called with a position on pointer enter, and with null on leave. */
    onhovertoken?: (position: number | null) => void;
  } = $props();

  const tokens = $derived(tokensAt(run, step));
  const highlighted = $derived(new Set(highlight));
  const interactive = $derived(onfocustoken !== undefined || onhovertoken !== undefined);
</script>

<ol class="token-sequence" aria-label={label}>
  {#each tokens as token, position (position)}
    {@const origin = position < run.nInput ? 'input' : 'generated'}
    <li>
      {#if interactive}
        <button
          type="button"
          class="token-button"
          onfocus={() => onfocustoken?.(position)}
          onblur={() => onfocustoken?.(null)}
          onclick={() => onfocustoken?.(position)}
          onmouseenter={() => onhovertoken?.(position)}
          onmouseleave={() => onhovertoken?.(null)}
        >
          <TokenChip {token} {position} {theme} {origin} highlighted={highlighted.has(position)} />
        </button>
      {:else}
        <TokenChip {token} {position} {theme} {origin} highlighted={highlighted.has(position)} />
      {/if}
    </li>
  {/each}
</ol>

<style>
  .token-sequence {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    max-width: 100%;
  }

  .token-button {
    display: flex;
    max-width: 100%;
    padding: 0;
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
  }
</style>
