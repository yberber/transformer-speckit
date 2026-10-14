<!--
  A technical term (FR-030, Principle III). The term stays English in every locale. Its first
  appearance in a view carries an inline plain-language explanation in the UI language; later
  appearances offer the explanation behind a small toggle.
-->
<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { glossary, t, type GlossaryId } from '../lib/i18n/index';
  import { getTermRegistry } from './termRegistry';

  let {
    id,
    label,
  }: {
    id: GlossaryId;
    /** The English word form used in the sentence (e.g. "tokens"); defaults to the term. */
    label?: string;
  } = $props();

  const registry = getTermRegistry();
  const owner = {};
  // Decided once, at the term's position in the view; without a registry, always explain.
  const termId = untrack(() => id);
  const first = registry ? registry.claim(termId, owner) : true;
  onDestroy(() => registry?.release(termId, owner));

  const entry = $derived(glossary(id));
  let open = $state(false);
  const noteId = $props.id();
</script>

{#if first}
  <span class="term"
    ><dfn lang="en">{label ?? entry.term}</dfn><span class="explanation">
      ({entry.explanation})</span
    ></span
  >
{:else}
  <span class="term"
    ><span lang="en">{label ?? entry.term}</span><button
      type="button"
      class="info"
      aria-expanded={open}
      aria-controls={noteId}
      aria-label={t('term.explain', { term: entry.term })}
      onclick={() => (open = !open)}>?</button
    ><span id={noteId} class="note" role="note" hidden={!open}>{entry.explanation}</span></span
  >
{/if}

<style>
  dfn {
    font-style: normal;
    font-weight: 600;
  }

  .explanation {
    color: var(--color-text-muted);
    font-size: 0.92em;
  }

  .info {
    display: inline-grid;
    place-items: center;
    width: 1.5em;
    height: 1.5em;
    margin-inline-start: 0.2em;
    padding: 0;
    font-size: 0.75em;
    font-weight: 700;
    line-height: 1;
    vertical-align: 0.15em;
    color: var(--color-accent);
    background: var(--color-accent-soft);
    border: 1px solid var(--color-border-strong);
    border-radius: 50%;
  }

  .note {
    display: block;
    margin-block: var(--space-1);
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-text);
    background: var(--color-surface-raised);
    border-inline-start: 3px solid var(--color-accent);
    border-radius: var(--radius-sm);
  }

  .note[hidden] {
    display: none;
  }
</style>
