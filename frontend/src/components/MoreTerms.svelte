<!--
  The glossary terms a view uses besides its main ones (FR-030): each stays English with its
  explanation one click away, so every term a view mentions is explained there without turning
  the top of the view into a glossary (Principle III).
-->
<script lang="ts">
  import { t, type GlossaryId } from '../lib/i18n/index';
  import Term from './Term.svelte';

  let { ids }: { ids: readonly GlossaryId[] } = $props();
</script>

<p class="more-terms" data-more-terms>
  <span class="label">{t('term.also_used')}</span>
  {#each ids as id (id)}
    <Term {id} compact />
  {/each}
</p>

<style>
  .more-terms {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-3);
    max-width: 65ch;
    margin: 0 0 var(--space-4);
    font-size: var(--text-sm);
  }

  .label {
    color: var(--color-text-muted);
  }
</style>
