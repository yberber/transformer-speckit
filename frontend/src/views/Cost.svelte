<!--
  Compute cost (FR-022–FR-024, US4-1..3): theoretical FLOP estimates for reading the input
  (prefill), for the token added at the current step (decode) and the running total, then a
  per-layer, per-component breakdown for either phase, the cost by context length (FR-025) and the
  KV-cache memory (FR-026). Every number comes from flops.ts or kvcache.ts (tested against the
  hand references, Principle II) and carries a "theoretical estimate" label with a link to its
  formula on "How we calculate" (FR-027).
-->
<script lang="ts">
  import CostChart from '../components/CostChart.svelte';
  import EstimateLabel from '../components/EstimateLabel.svelte';
  import ShowDetails from '../components/ShowDetails.svelte';
  import Term from '../components/Term.svelte';
  import { createTermRegistry } from '../components/termRegistry';
  import ViewIntro from '../components/ViewIntro.svelte';
  import { glossary, t } from '../lib/i18n/index';
  import { formatBytes, formatCompact, formatNumber } from '../lib/i18n/format';
  import { modelConfig } from '../lib/model/config';
  import {
    costAtStep,
    FORMULA_IDS,
    LAYER_COMPONENTS,
    type CostEstimate,
    type FlopBreakdown,
  } from '../lib/model/flops';
  import { kvCacheBytes } from '../lib/model/kvcache';
  import { methodHref, openFormula } from '../lib/state/methodLink';
  import type { ViewProps } from './types';

  let { view, run, step }: ViewProps = $props();

  createTermRegistry();
  const uid = $props.id();
  const headingId = `${uid}-heading`;

  const cost = $derived(run ? costAtStep(modelConfig, run.nInput, step) : null);
  const flops = $derived(glossary('flops').term);
  /** Tokens in context at step k: the input plus the generated tokens. */
  const contextLength = $derived(run ? run.nInput + step : 0);
  const kv = $derived(run ? kvCacheBytes(modelConfig, contextLength) : null);
  const fmt = (n: number) => formatNumber(n);

  // --- headline figures -------------------------------------------------------------------

  interface Figure {
    id: 'prefill' | 'decode' | 'running-total';
    title: string;
    detail: string;
    estimate: CostEstimate | null;
  }

  const figures = $derived.by((): Figure[] => {
    if (!cost || !run) return [];
    return [
      {
        id: 'prefill',
        title: t('cost.prefill.title'),
        detail: t('cost.prefill.detail', { count: run.nInput }),
        estimate: cost.prefill.total,
      },
      {
        id: 'decode',
        title: t('cost.decode.title'),
        detail: t('cost.decode.detail', { step, t: run.nInput + step }),
        estimate: cost.decode?.total ?? null,
      },
      {
        id: 'running-total',
        title: t('cost.total.title'),
        detail: t('cost.total.detail', { count: step }),
        estimate: cost.runningTotal,
      },
    ];
  });

  // --- per-layer table --------------------------------------------------------------------

  let phase = $state<'prefill' | 'decode'>('prefill');
  const table = $derived<FlopBreakdown | null>(
    cost ? (phase === 'prefill' ? cost.prefill : cost.decode) : null,
  );

  const NON_LAYER = ['pos_add', 'lm_head'] as const;
  const layers = Array.from({ length: modelConfig.nLayer }, (_, i) => i + 1);

  function layerRow(b: FlopBreakdown, layer: number): CostEstimate[] {
    return LAYER_COMPONENTS.map((c) =>
      b.breakdown.find((e) => e.layer === layer && e.component === c)!,
    );
  }

  function nonLayer(b: FlopBreakdown, component: (typeof NON_LAYER)[number]): CostEstimate {
    return b.breakdown.find((e) => e.component === component)!;
  }

  const caption = $derived.by(() => {
    if (!run) return '';
    return phase === 'prefill'
      ? t('cost.table.caption.prefill', { count: run.nInput })
      : t('cost.table.caption.decode', { t: run.nInput + step });
  });
</script>

<section class="view" data-view={view} aria-labelledby={headingId}>
  <ViewIntro {view} {headingId} />

  {#if run && cost}
    <ul class="terms">
      <li><Term id="flops" /></li>
      <li><Term id="prefill" /></li>
      <li><Term id="decode" /></li>
    </ul>

    <p class="assumptions muted">{t('cost.assumptions')}</p>

    <div class="figures">
      {#each figures as f (f.id)}
        <article
          class="figure surface"
          data-cost-figure={f.id}
          data-value={f.estimate?.value}
          data-estimate
          aria-labelledby="{uid}-{f.id}"
        >
          <h3 id="{uid}-{f.id}" class="figure-title">{f.title}</h3>
          {#if f.estimate}
            <p class="figure-value">
              <span class="num" data-compact>{formatCompact(f.estimate.value)}</span>
              <span class="unit" lang="en">{flops}</span>
            </p>
            <p class="figure-detail muted">{f.detail}</p>
          {:else}
            <p class="no-token" data-no-token>{t('cost.decode.none')}</p>
          {/if}
          <EstimateLabel formulaId={f.estimate?.formulaId ?? FORMULA_IDS.decode} what={f.title} />
        </article>
      {/each}
    </div>

    <div data-cost-details>
      <ShowDetails>
        <dl class="exact">
          {#each figures as f (f.id)}
            <div>
              <dt>{f.title}</dt>
              <dd class="num" data-exact={f.id}>
                {f.estimate ? fmt(f.estimate.value) : t('cost.decode.none_short')}
              </dd>
            </div>
          {/each}
        </dl>
        <p class="muted unit-note">{t('cost.exact_unit', { unit: flops })}</p>
      </ShowDetails>
    </div>

    <section class="breakdown" aria-labelledby="{uid}-table" data-estimate>
      <h3 id="{uid}-table">{t('cost.table.title')}</h3>

      <fieldset class="phase" data-phase-toggle>
        <legend>{t('cost.phase.label')}</legend>
        <div class="phase-options">
          <label>
            <input type="radio" name="{uid}-phase" value="prefill" bind:group={phase} />
            {t('cost.phase.prefill')}
          </label>
          <label>
            <input type="radio" name="{uid}-phase" value="decode" bind:group={phase} />
            {t('cost.phase.decode')}
          </label>
        </div>
      </fieldset>

      <EstimateLabel
        formulaId={phase === 'prefill' ? FORMULA_IDS.prefill : FORMULA_IDS.decode}
        what={t('cost.table.title')}
      />

      {#if table}
        <!-- The long description sits outside the scrolling box, so narrow screens show it all. -->
        <p class="muted table-note" id="{uid}-caption">{caption} {t('cost.table.same_note')}</p>
        <!-- A scrolling region must be focusable, so keyboard users can scroll it (WCAG 2.1.1). -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div
          class="scroll-x table-wrap"
          role="region"
          aria-label={t('cost.table.label')}
          aria-describedby="{uid}-caption"
          tabindex="0"
        >
          <table data-cost-table data-phase={phase}>
            <caption class="visually-hidden">{t('cost.table.label')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('cost.col.part')}</th>
                {#each LAYER_COMPONENTS as c (c)}
                  <th scope="col" class="end">
                    <a
                      href={methodHref(FORMULA_IDS[c])}
                      data-formula-link={FORMULA_IDS[c]}
                      onclick={(e) => openFormula(e, FORMULA_IDS[c])}>{t(`cost.component.${c}`)}</a
                    >
                  </th>
                {/each}
                <th scope="col" class="end">{t('cost.col.total')}</th>
              </tr>
            </thead>
            <tbody>
              {#each layers as layer (layer)}
                {@const row = layerRow(table, layer)}
                {@const sum = row.reduce((s, e) => s + e.value, 0)}
                <tr data-row="layer-{layer}">
                  <th scope="row">{t('layer.option', { n: layer })}</th>
                  {#each row as e (e.component)}
                    <td class="num" data-cell={e.component} data-value={e.value}>{fmt(e.value)}</td>
                  {/each}
                  <td class="num" data-cell="total" data-value={sum}>{fmt(sum)}</td>
                </tr>
              {/each}
              {#each NON_LAYER as component (component)}
                {@const e = nonLayer(table, component)}
                <tr class="non-layer" data-row={component}>
                  <th scope="row">
                    <a
                      href={methodHref(e.formulaId)}
                      data-formula-link={e.formulaId}
                      onclick={(ev) => openFormula(ev, e.formulaId)}
                      >{t(`cost.component.${component}`)}</a
                    >
                  </th>
                  {#each LAYER_COMPONENTS as c (c)}
                    <td class="num empty"><span aria-hidden="true">–</span></td>
                  {/each}
                  <td class="num" data-cell="total" data-value={e.value}>{fmt(e.value)}</td>
                </tr>
              {/each}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colspan={LAYER_COMPONENTS.length + 1}>{t('cost.row.total')}</th>
                <td class="num" data-cell="total" data-value={table.total.value}>
                  {fmt(table.total.value)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      {:else}
        <p class="no-token" data-no-token>{t('cost.decode.none')}</p>
      {/if}
    </section>

    <CostChart current={contextLength} />

    {#if kv}
      <section class="kv surface" aria-labelledby="{uid}-kv" data-kv-cache data-estimate>
        <h3 id="{uid}-kv">{t('cost.kv.title')}</h3>
        <p class="kv-value">
          <span class="num" data-kv-bytes data-value={kv.value}>{formatBytes(kv.value)}</span>
          <span class="muted">{t('cost.kv.for', { count: contextLength })}</span>
        </p>
        <p class="kv-text"><Term id="kv-cache" /> {t('cost.kv.explanation')}</p>
        <p class="kv-text muted">
          {t('cost.kv.precision', { bytes: fmt(kv.value) })}
        </p>
        <EstimateLabel formulaId={kv.formulaId} what={t('cost.kv.title')} />
      </section>
    {/if}
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

  .assumptions {
    max-width: 65ch;
    margin: 0 0 var(--space-5);
    font-size: var(--text-sm);
  }

  .figures {
    display: grid;
    gap: var(--space-4);
  }

  @media (min-width: 48rem) {
    .figures {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  .figure {
    display: grid;
    align-content: start;
    gap: var(--space-2);
    padding: var(--space-4);
  }

  .figure-title {
    margin: 0;
    font-size: var(--text-base);
  }

  .figure-value {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
    margin: 0;
  }

  .figure-value .num {
    font-size: var(--text-2xl);
    font-weight: 700;
  }

  .unit {
    font-weight: 600;
    color: var(--color-text-muted);
  }

  .figure-detail,
  .no-token {
    margin: 0;
    font-size: var(--text-sm);
  }

  .no-token {
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-raised);
    border-inline-start: 3px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
  }

  .exact {
    display: grid;
    gap: var(--space-2);
    margin: 0;
  }

  .exact div {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-1) var(--space-3);
    max-width: 36rem;
    padding-block: var(--space-1);
    border-bottom: 1px solid var(--color-border);
  }

  .exact dd {
    margin: 0;
    font-weight: 600;
  }

  .unit-note {
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
  }

  .breakdown {
    margin-top: var(--space-6);
  }

  .kv {
    display: grid;
    gap: var(--space-2);
    max-width: 44rem;
    margin-top: var(--space-6);
    padding: var(--space-4);
  }

  .kv h3,
  .kv p {
    margin: 0;
  }

  .kv-value {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-3);
  }

  .kv-value .num {
    font-size: var(--text-2xl);
    font-weight: 700;
  }

  .kv-text {
    max-width: 65ch;
  }

  .kv-text.muted {
    font-size: var(--text-sm);
  }

  .breakdown h3 {
    margin: 0 0 var(--space-3);
  }

  .phase {
    margin: 0 0 var(--space-3);
    padding: 0;
    border: 0;
  }

  .phase legend {
    margin-bottom: var(--space-1);
    padding: 0;
    font-weight: 600;
  }

  .phase-options {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--space-5);
  }

  .phase label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 2.5rem;
  }

  .phase input {
    width: 1.1rem;
    height: 1.1rem;
    margin: 0;
    accent-color: var(--color-accent);
  }

  .table-note {
    max-width: 65ch;
    margin: var(--space-3) 0;
    font-size: var(--text-sm);
  }

  .breakdown > .no-token {
    margin-top: var(--space-3);
  }

  .table-wrap {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  th,
  td {
    padding: var(--space-1) var(--space-3);
    text-align: start;
    white-space: nowrap;
    border-top: 1px solid var(--color-border);
  }

  thead th {
    vertical-align: bottom;
    white-space: normal;
    min-width: 7rem;
    background: var(--color-surface-raised);
  }

  thead th:first-child {
    min-width: 0;
  }

  thead a,
  tbody a {
    font-weight: 600;
    color: var(--color-accent);
    text-underline-offset: 0.15em;
  }

  tbody th {
    font-weight: 400;
  }

  td.num,
  th.end {
    text-align: end;
  }

  td.empty {
    color: var(--color-text-muted);
  }

  tr.non-layer th,
  tr.non-layer td {
    background: var(--color-surface-raised);
  }

  tr[data-row='pos_add'] th,
  tr[data-row='pos_add'] td {
    border-top: 2px solid var(--color-border-strong);
  }

  tfoot th,
  tfoot td {
    font-weight: 700;
    border-top: 2px solid var(--color-border-strong);
  }
</style>
