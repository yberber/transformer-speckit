<!--
  Transformer blocks (FR-016, US2-2/3): step through every block, one at a time or directly. A
  schematic shows what happens inside one block, with every size read from the model config; two
  bar charts show how strongly the attention part and the MLP part changed each token at the
  current step (real values from the run). Changing the layer sends a pulse through the schematic.
-->
<script lang="ts">
  import ChangeBars from '../components/ChangeBars.svelte';
  import LayerSelector from '../components/LayerSelector.svelte';
  import Term from '../components/Term.svelte';
  import { createTermRegistry } from '../components/termRegistry';
  import ViewIntro from '../components/ViewIntro.svelte';
  import { changeAt } from '../lib/data/runData';
  import { glossary, t, type MessageKey } from '../lib/i18n/index';
  import { formatNumber } from '../lib/i18n/format';
  import { activationLabelKey, modelConfig } from '../lib/model/config';
  import { duration } from '../lib/motion';
  import { viewState } from '../lib/state/viewState.svelte';
  import type { ViewProps } from './types';

  let { view, run, step }: ViewProps = $props();

  createTermRegistry();
  const headingId = $props.id();

  const layer = $derived(viewState.layer);
  const change = $derived(run ? changeAt(run, layer, step) : null);
  /** One scale for both parts, so their bars can be compared. */
  const max = $derived(change ? Math.max(0, ...change.attn, ...change.mlp) : 0);

  const sizes = {
    d: formatNumber(modelConfig.nEmbd),
    f: formatNumber(modelConfig.nInner),
  };
  const activation = $derived(t(activationLabelKey() as MessageKey));
  const pulseMs = $derived(duration(1400));
</script>

<section class="view" data-view={view} aria-labelledby={headingId}>
  <ViewIntro {view} {headingId} />

  <ul class="terms">
    <li><Term id="layer" /></li>
    <li><Term id="attention" /></li>
    <li><Term id="mlp" /></li>
  </ul>

  <LayerSelector />

  {#key layer}
    <figure class="panel schematic" style:--pulse-ms="{pulseMs}ms" data-block-schematic>
      <figcaption class="schematic-title">
        {t('blocks.schematic', { n: layer })}
      </figcaption>
      <ol class="stages">
        <li class="stage io" style:--i={0}>
          <span class="name">{t('blocks.stage.input')}</span>
          <span class="detail muted">{t('blocks.stage.input_detail', { d: sizes.d })}</span>
        </li>
        <li class="stage" style:--i={1}>
          <span class="name">{t('blocks.stage.layer_norm')}</span>
          <span class="detail muted">{t('blocks.stage.layer_norm_detail')}</span>
        </li>
        <li class="stage part" style:--i={2}>
          <span class="name" lang="en">{glossary('attention').term}</span>
          <span class="detail muted">
            {t('blocks.stage.attention_detail', {
              heads: modelConfig.nHead,
              dHead: modelConfig.dHead,
            })}
          </span>
        </li>
        <li class="stage add" style:--i={3}>
          <span class="name"
            ><span class="plus" aria-hidden="true">+</span>{t('blocks.stage.add')}</span
          >
          <span class="detail muted">{t('blocks.stage.add_detail')}</span>
        </li>
        <li class="stage" style:--i={4}>
          <span class="name">{t('blocks.stage.layer_norm')}</span>
          <span class="detail muted">{t('blocks.stage.layer_norm_detail')}</span>
        </li>
        <li class="stage part" style:--i={5}>
          <span class="name" lang="en">{glossary('mlp').term}</span>
          <span class="detail mlp" aria-hidden="true">
            <span class="num" data-mlp-size="in">{sizes.d}</span>
            <span class="arrow">→</span>
            <span class="num" data-mlp-size="hidden">{sizes.f}</span>
            <span class="arrow">→</span>
            <span class="activation">{activation}</span>
            <span class="arrow">→</span>
            <span class="num" data-mlp-size="out">{sizes.d}</span>
          </span>
          <span class="visually-hidden">
            {t('blocks.stage.mlp_detail', { d: sizes.d, f: sizes.f, activation })}
          </span>
        </li>
        <li class="stage add" style:--i={6}>
          <span class="name"
            ><span class="plus" aria-hidden="true">+</span>{t('blocks.stage.add')}</span
          >
          <span class="detail muted">{t('blocks.stage.add_detail')}</span>
        </li>
        <li class="stage io" style:--i={7}>
          <span class="name">{t('blocks.stage.output')}</span>
          <span class="detail muted">
            {layer < modelConfig.nLayer
              ? t('blocks.stage.output_next', { next: layer + 1 })
              : t('blocks.stage.output_last')}
          </span>
        </li>
      </ol>
    </figure>
  {/key}

  {#if run && change}
    <div class="parts">
      <ChangeBars
        {run}
        values={change.attn}
        kind="attn"
        title={t('blocks.attn_title')}
        theme={viewState.resolvedTheme}
        {max}
      />
      <ChangeBars
        {run}
        values={change.mlp}
        kind="mlp"
        title={t('blocks.mlp_title')}
        theme={viewState.resolvedTheme}
        {max}
      />
    </div>

    <button
      type="button"
      class="to-attention"
      data-action="to-attention"
      onclick={() => viewState.setView('attention')}
    >
      {t('blocks.to_attention', { n: layer })}
      <span aria-hidden="true">→</span>
    </button>
  {/if}
</section>

<style>
  .terms {
    display: grid;
    gap: var(--space-2);
    max-width: 65ch;
    margin: 0 0 var(--space-4);
    padding: 0;
    list-style: none;
  }

  .schematic {
    margin: var(--space-4) 0 var(--space-5);
    padding: var(--space-4);
  }

  .schematic-title {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-panel-muted);
  }

  .stages {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .stage {
    position: relative;
    display: grid;
    align-content: start;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    background: var(--color-panel-raised);
    border: 1px solid var(--color-panel-border);
    border-radius: var(--radius-md);
    animation: pulse var(--pulse-ms) ease-out calc(var(--i) * var(--pulse-ms) / 10) both;
  }

  .stage.part {
    border-color: var(--color-panel-muted);
    border-width: 2px;
  }

  .stage.add,
  .stage.io {
    border-style: dashed;
  }

  .name {
    font-weight: 700;
  }

  .plus {
    margin-inline-end: 0.3em;
  }

  .detail {
    font-size: var(--text-xs);
  }

  .mlp {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 var(--space-1);
    font-size: var(--text-sm);
  }

  .arrow {
    color: var(--color-panel-muted);
  }

  .activation {
    font-size: var(--text-xs);
  }

  /* A glow passes from stage to stage: the outline changes, the text never fades. */
  @keyframes pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 transparent;
    }
    25% {
      box-shadow: 0 0 0 3px var(--color-focus);
    }
  }

  .parts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
    gap: var(--space-5);
  }

  .to-attention {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 2.75rem;
    margin-top: var(--space-4);
    padding: var(--space-2) var(--space-4);
    font-weight: 700;
    color: var(--color-accent-contrast);
    background: var(--color-accent);
    border: 0;
    border-radius: var(--radius-pill);
  }
</style>
