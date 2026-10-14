<!--
  Choose one of the six examples, grouped by length (FR-003). A native radio group: arrow keys
  move between examples and screen readers announce the group and the choice. Selecting an
  example goes back to step 0 and keeps the view, layer and head.
-->
<script lang="ts">
  import type { ExampleEntry, ExampleLength } from '../lib/data/exampleSource';
  import { t, type MessageKey } from '../lib/i18n/index';
  import { viewState } from '../lib/state/viewState.svelte';

  let {
    examples,
    tokenCounts = {},
  }: {
    examples: ExampleEntry[];
    /** Input token count per example ID, for the examples loaded so far. */
    tokenCounts?: Record<string, number>;
  } = $props();

  const LENGTHS: readonly ExampleLength[] = ['short', 'medium', 'long'];
  const groups = $derived(
    LENGTHS.map((length) => ({ length, examples: examples.filter((e) => e.length === length) })),
  );

  // Example IDs come from index.json; the i18n completeness test checks each has a title.
  const titleKey = (id: string) => `example.${id}.title` as MessageKey;

  const uid = $props.id();
</script>

<fieldset class="example-picker" data-example-picker>
  <legend>{t('example.picker.label')}</legend>
  <div class="groups">
    {#each groups as group (group.length)}
      <div
        class="group"
        role="group"
        aria-labelledby="{uid}-{group.length}"
        data-example-group={group.length}
      >
        <span class="group-label" id="{uid}-{group.length}">
          {t(`example.length.${group.length}`)}
        </span>
        {#each group.examples as example (example.id)}
          {@const count = tokenCounts[example.id]}
          <label class="option" data-example-option={example.id}>
            <input
              type="radio"
              name="{uid}-example"
              value={example.id}
              checked={viewState.exampleId === example.id}
              onchange={() => viewState.setExample(example.id)}
            />
            <span class="text">
              <span class="title">{t(titleKey(example.id))}</span>
              {#if count !== undefined}
                <span class="count">{t('example.token_count', { count })}</span>
              {/if}
            </span>
          </label>
        {/each}
      </div>
    {/each}
  </div>
</fieldset>

<style>
  .example-picker {
    min-width: 0;
    margin: 0 0 var(--space-4);
    padding: 0;
    border: 0;
  }

  legend {
    margin-bottom: var(--space-2);
    padding: 0;
    font-weight: 700;
  }

  .groups {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: var(--space-3);
  }

  .group {
    display: grid;
    gap: var(--space-2);
    align-content: start;
  }

  .group-label {
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .option {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
  }

  .option:hover {
    border-color: var(--color-border-strong);
  }

  /* Selected: a thicker accent border as well as the filled radio, not color alone. */
  .option:has(input:checked) {
    border-color: var(--color-accent);
    box-shadow: inset 0 0 0 1px var(--color-accent);
    background: var(--color-accent-soft);
  }

  input {
    flex: none;
    width: 1.1rem;
    height: 1.1rem;
    margin: 0.2rem 0 0;
    accent-color: var(--color-accent);
  }

  .text {
    display: grid;
    gap: 0.1rem;
  }

  .title {
    font-weight: 600;
  }

  .count {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }
</style>
