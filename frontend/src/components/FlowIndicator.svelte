<!--
  Persistent "you are here" indicator (FR-021): the path text → tokens → embeddings → blocks →
  attention → prediction, with the current flow view lit. Reference views say so instead.
-->
<script lang="ts">
  import { t } from '../lib/i18n/index';
  import { FLOW_VIEWS, type ViewId } from '../lib/state/viewState.svelte';

  let { current }: { current: ViewId } = $props();

  const inFlow = $derived(FLOW_VIEWS.includes(current));
  const name = $derived(t(`view.${current}.name`));
</script>

<div class="flow-indicator">
  <ol class="steps" aria-label={t('flow.label')}>
    <li class="step">{t('flow.text')}</li>
    {#each FLOW_VIEWS as view (view)}
      <li
        class="step"
        class:current={view === current}
        aria-current={view === current ? 'step' : undefined}
      >
        {t(`view.${view}.name`)}
      </li>
    {/each}
  </ol>
  <p class="status">
    {inFlow ? t('flow.current', { view: name }) : t('flow.reference', { view: name })}
  </p>
</div>

<style>
  .flow-indicator {
    padding: var(--space-3) var(--space-4);
    color: var(--color-panel-text);
    background: var(--color-panel);
    border: 1px solid var(--color-panel-border);
    border-radius: var(--radius-lg);
  }

  .steps {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) 0;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-sm);
  }

  .step {
    display: inline-flex;
    align-items: center;
    color: var(--color-panel-muted);
  }

  .step + .step::before {
    content: '→';
    margin-inline: var(--space-2);
    color: var(--color-panel-muted);
  }

  .step.current {
    font-weight: 700;
    color: var(--color-panel-text);
  }

  .step.current::after {
    content: '';
    width: 0.5em;
    height: 0.5em;
    margin-inline-start: var(--space-1);
    background: var(--color-focus);
    border-radius: 50%;
  }

  .status {
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
    color: var(--color-panel-text);
  }
</style>
