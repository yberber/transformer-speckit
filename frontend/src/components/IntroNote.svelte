<!--
  First-visit note (FR-002): GPT-2 continues text; it is not a chat assistant. It can be hidden
  for the rest of the visit. The choice is kept in memory only, so a reload shows it again.
-->
<script module lang="ts">
  let dismissed = $state(false);
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../lib/i18n/index';

  let note: HTMLElement | undefined = $state();

  async function dismiss(): Promise<void> {
    // The button disappears with the note: keep keyboard focus nearby, at the main content.
    const main = note?.closest<HTMLElement>('main');
    dismissed = true;
    await tick();
    main?.focus();
  }
</script>

{#if !dismissed}
  <div class="intro-note" role="note" data-intro-note bind:this={note}>
    <p>{t('intro.note')}</p>
    <button type="button" class="dismiss" onclick={dismiss}>{t('intro.dismiss')}</button>
  </div>
{/if}

<style>
  .intro-note {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-4);
    max-width: 65ch;
    margin-block: var(--space-3) var(--space-4);
    padding: var(--space-3) var(--space-4);
    background: var(--color-accent-soft);
    border: 1px solid var(--color-border);
    border-inline-start: 4px solid var(--color-accent);
    border-radius: var(--radius-md);
  }

  p {
    flex: 1 1 24ch;
    margin: 0;
  }

  .dismiss {
    min-height: 2.5rem;
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-accent);
    background: var(--color-surface);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-pill);
  }

  .dismiss:hover {
    background: var(--color-surface-raised);
  }
</style>
