<!--
  Context-length chart (FR-025, US4-4): the estimated decode cost of one new token for every
  context length from 1 to the model's maximum (n_positions from the config), as a hand-written
  inline SVG line, with the current context length marked. The y axis starts at 0, so the chart
  shows honestly how small the growth is. A text summary and a "Show as table" alternative carry
  the same information; every value comes from flops.ts.
-->
<script lang="ts">
  import EstimateLabel from './EstimateLabel.svelte';
  import { t } from '../lib/i18n/index';
  import { formatCompact, formatNumber } from '../lib/i18n/format';
  import { modelConfig } from '../lib/model/config';
  import { decodeFlops, FORMULA_IDS } from '../lib/model/flops';

  let {
    current,
  }: {
    /** Current context length: input tokens plus generated tokens. */
    current: number;
  } = $props();

  const uid = $props.id();
  const maxT = modelConfig.nPositions;

  /** decode(t) for t = 1..maxT; index t − 1. Depends only on the config, so computed once. */
  const values = Array.from(
    { length: maxT },
    (_, i) => decodeFlops(modelConfig, i + 1).total.value,
  );
  const valueAt = (ctx: number) => values[ctx - 1]!;
  const currentValue = $derived(valueAt(current));

  // --- scales -----------------------------------------------------------------------------

  /** A "nice" tick step (1, 2, 2.5 or 5 × 10ⁿ) giving about `count` intervals up to `max`. */
  function niceStep(max: number, count: number): number {
    const raw = max / count;
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    const normalized = raw / magnitude;
    const factor = [1, 2, 2.5, 5, 10].find((f) => f >= normalized)!;
    return factor * magnitude;
  }

  const yStep = niceStep(values[maxT - 1]!, 3);
  const yMax = Math.ceil(values[maxT - 1]! / yStep) * yStep;
  const yTicks = Array.from({ length: Math.round(yMax / yStep) + 1 }, (_, i) => i * yStep);
  const xStep = niceStep(maxT, 4);
  const xTicks = [
    1,
    ...Array.from({ length: Math.floor(maxT / xStep) }, (_, i) => (i + 1) * xStep),
  ];

  let width = $state(640);
  const HEIGHT = 260;
  const M = { top: 28, right: 20, bottom: 48, left: 64 };
  const plotW = $derived(Math.max(120, width - M.left - M.right));
  const plotH = HEIGHT - M.top - M.bottom;

  const x = (ctx: number) => M.left + ((ctx - 1) / (maxT - 1)) * plotW;
  const y = (v: number) => M.top + plotH - (v / yMax) * plotH;

  // The line is straight (decode cost is linear in t), but every point is drawn as computed.
  const path = $derived(
    values
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`)
      .join(''),
  );

  const markerX = $derived(x(current));
  const markerY = $derived(y(currentValue));
  /** Keep the marker label inside the plot near the right edge. */
  const labelAnchor = $derived(markerX > M.left + plotW * 0.6 ? 'end' : 'start');

  // --- text -------------------------------------------------------------------------------

  const summary = $derived(
    t('cost.chart.summary', {
      from: formatCompact(values[0]!),
      to: formatCompact(values[maxT - 1]!),
      max: maxT,
      t: current,
      current: formatCompact(currentValue),
    }),
  );

  // --- table ------------------------------------------------------------------------------

  const TABLE_EVERY = 64;
  let tableOpen = $state(false);
  const every = Array.from(
    { length: Math.floor(maxT / TABLE_EVERY) },
    (_, i) => (i + 1) * TABLE_EVERY,
  );
  const rows = $derived(
    every.includes(current) ? every : [...every, current].sort((a, b) => a - b),
  );
</script>

<section class="cost-chart" aria-labelledby="{uid}-title" data-cost-chart-block data-estimate>
  <h3 id="{uid}-title">{t('cost.chart.title')}</h3>
  <p id="{uid}-summary" class="summary" data-chart-summary>{summary}</p>
  <EstimateLabel formulaId={FORMULA_IDS.decode} what={t('cost.chart.title')} />

  <div class="plot surface" bind:clientWidth={width}>
    <!-- Focusable so keyboard and screen-reader users reach the chart and hear its summary. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <svg
      data-cost-chart
      role="img"
      tabindex="0"
      aria-labelledby="{uid}-title"
      aria-describedby="{uid}-summary"
      viewBox="0 0 {M.left + plotW + M.right} {HEIGHT}"
      width="100%"
      height={HEIGHT}
    >
      <g aria-hidden="true">
        {#each yTicks as v (v)}
          <line class="grid" x1={M.left} x2={M.left + plotW} y1={y(v)} y2={y(v)} />
          <text class="tick" x={M.left - 8} y={y(v)} text-anchor="end" dominant-baseline="middle"
            >{formatCompact(v)}</text
          >
        {/each}
        {#each xTicks as ctx (ctx)}
          <line
            class="tick-mark"
            x1={x(ctx)}
            x2={x(ctx)}
            y1={M.top + plotH}
            y2={M.top + plotH + 5}
          />
          <text class="tick" x={x(ctx)} y={M.top + plotH + 18} text-anchor="middle"
            >{formatNumber(ctx)}</text
          >
        {/each}
        <line class="axis" x1={M.left} x2={M.left + plotW} y1={M.top + plotH} y2={M.top + plotH} />
        <text class="axis-label" x={M.left + plotW / 2} y={HEIGHT - 6} text-anchor="middle"
          >{t('cost.chart.x_axis')}</text
        >
        <text class="axis-label" x={M.left - 56} y={M.top - 12}>{t('cost.chart.y_axis')}</text>

        <path class="line" d={path} />

        <g data-current-marker data-t={current}>
          <line class="marker-line" x1={markerX} x2={markerX} y1={M.top} y2={M.top + plotH} />
          <circle class="marker-dot" cx={markerX} cy={markerY} r="5" />
          <text
            class="marker-label"
            x={markerX + (labelAnchor === 'end' ? -8 : 8)}
            y={M.top + 12}
            text-anchor={labelAnchor}
            >{t('cost.chart.marker', { t: current, value: formatCompact(currentValue) })}</text
          >
        </g>
      </g>
    </svg>
  </div>

  <button
    type="button"
    class="table-toggle"
    aria-expanded={tableOpen}
    aria-controls="{uid}-table"
    data-show-table
    onclick={() => (tableOpen = !tableOpen)}
  >
    {tableOpen ? t('table.hide') : t('table.show')}
  </button>
  <div id="{uid}-table" hidden={!tableOpen}>
    {#if tableOpen}
      <!-- A scrolling region must be focusable, so keyboard users can scroll it (WCAG 2.1.1). -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        class="scroll-x table-wrap"
        role="region"
        aria-label={t('cost.chart.table_caption', { every: TABLE_EVERY })}
        tabindex="0"
      >
        <table data-chart-table>
          <caption>{t('cost.chart.table_caption', { every: TABLE_EVERY })}</caption>
          <thead>
            <tr>
              <th scope="col">{t('cost.chart.x_axis')}</th>
              <th scope="col" class="end">{t('cost.chart.y_axis')}</th>
            </tr>
          </thead>
          <tbody>
            {#each rows as ctx (ctx)}
              <tr data-t={ctx} class:current={ctx === current}>
                <th scope="row">
                  <span class="num">{formatNumber(ctx)}</span>
                  {#if ctx === current}
                    <span class="current-tag">{t('cost.chart.current')}</span>
                  {/if}
                </th>
                <td class="num" data-cell="value">{formatNumber(valueAt(ctx))}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</section>

<style>
  .cost-chart {
    margin-top: var(--space-6);
  }

  h3 {
    margin: 0 0 var(--space-2);
  }

  .summary {
    max-width: 65ch;
    margin: 0 0 var(--space-2);
  }

  .plot {
    margin-top: var(--space-3);
    padding: var(--space-2) 0;
    overflow: hidden;
  }

  svg {
    display: block;
    border-radius: var(--radius-md);
  }

  .grid {
    stroke: var(--color-border);
  }

  .axis,
  .tick-mark {
    stroke: var(--color-border-strong);
  }

  .tick,
  .axis-label {
    font-size: 12px;
    fill: var(--color-text-muted);
  }

  .tick {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  .axis-label {
    font-weight: 600;
  }

  .line {
    fill: none;
    stroke: var(--color-accent);
    stroke-width: 2.5;
    stroke-linejoin: round;
  }

  .marker-line {
    stroke: var(--color-text);
    stroke-width: 1.5;
    stroke-dasharray: 4 3;
  }

  .marker-dot {
    fill: var(--color-accent);
    stroke: var(--color-surface);
    stroke-width: 2;
  }

  .marker-label {
    font-size: 12px;
    font-weight: 700;
    fill: var(--color-text);
    paint-order: stroke;
    stroke: var(--color-surface);
    stroke-width: 4px;
    stroke-linejoin: round;
  }

  .table-toggle {
    min-height: 2.5rem;
    margin-top: var(--space-3);
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-accent);
    background: transparent;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-pill);
  }

  .table-toggle:hover {
    background: var(--color-accent-soft);
  }

  .table-wrap {
    max-width: 30rem;
    max-height: 24rem;
    margin-top: var(--space-3);
    overflow-y: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  caption {
    padding: var(--space-2) var(--space-3);
    text-align: start;
    color: var(--color-text-muted);
  }

  th,
  td {
    padding: var(--space-1) var(--space-3);
    text-align: start;
    white-space: nowrap;
    border-top: 1px solid var(--color-border);
  }

  thead th {
    background: var(--color-surface-raised);
  }

  tbody th {
    font-weight: 400;
  }

  td.num,
  th.end {
    text-align: end;
  }

  tr.current th,
  tr.current td {
    font-weight: 700;
    background: var(--color-accent-soft);
  }

  .current-tag {
    margin-inline-start: var(--space-2);
    font-size: var(--text-xs);
  }
</style>
