<!--
  How strongly one part of a block (attention or MLP) changed each token (FR-016): the length of
  the update the part adds, divided by the length of the token's vector before the part, × 100.
  One row per token: its chip, a bar and the percentage. Bars share the `max` scale the parent
  passes, so the attention and MLP parts of a block can be compared. Exact values are in the
  details table.
-->
<script lang="ts">
  import type { RunData } from '../lib/data/runData';
  import { t } from '../lib/i18n/index';
  import { formatNumber, formatPercent } from '../lib/i18n/format';
  import type { Theme } from '../lib/tokens/palette';
  import ShowDetails from './ShowDetails.svelte';
  import TokenChip from './TokenChip.svelte';

  let {
    run,
    values,
    kind,
    title,
    theme,
    max,
  }: {
    run: RunData;
    /** Change percentages (already × 100), one per visible token, by position. */
    values: number[];
    kind: 'attn' | 'mlp';
    title: string;
    theme: Theme;
    /** Value of a full-width bar; defaults to the largest value shown. */
    max?: number;
  } = $props();

  const scale = $derived(max ?? Math.max(0, ...values));
  const headingId = $props.id();

  const shown = (pct: number) => formatPercent(pct / 100, 1);
  const exact = (pct: number) =>
    formatNumber(pct / 100, {
      style: 'percent',
      minimumSignificantDigits: 7,
      maximumSignificantDigits: 7,
    });
  const origin = (position: number) => (position < run.nInput ? 'input' : 'generated');
</script>

<figure class="change-bars" aria-labelledby={headingId} data-change-bars={kind}>
  <figcaption>
    <h4 id={headingId}>{title}</h4>
    <p class="muted">{t('change.caption')}</p>
  </figcaption>

  <ol class="rows">
    {#each values as pct, position (position)}
      <li data-change-row data-position={position}>
        <span class="token">
          <TokenChip token={run.tokens[position]!} {position} {theme} origin={origin(position)} />
        </span>
        <span class="bar" aria-hidden="true">
          <span class="fill" style:width="{scale > 0 ? (pct / scale) * 100 : 0}%"></span>
        </span>
        <span class="value num" data-change-value>{shown(pct)}</span>
      </li>
    {/each}
  </ol>

  <ShowDetails>
    <!-- A scrolling region must be focusable, so keyboard users can scroll it (WCAG 2.1.1). -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="scroll-x table-wrap" role="region" aria-label={title} tabindex="0">
      <table data-change-table={kind}>
        <caption>{t('change.table_caption', { part: title })}</caption>
        <thead>
          <tr>
            <th scope="col">{t('tokens.col.position')}</th>
            <th scope="col">{t('tokens.col.id')}</th>
            <th scope="col">{t('change.col.value')}</th>
          </tr>
        </thead>
        <tbody>
          {#each values as pct, position (position)}
            <tr>
              <th scope="row" class="num">{position + 1}</th>
              <td class="num">{run.tokens[position]!.id}</td>
              <td class="num" data-col="change">{exact(pct)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </ShowDetails>
</figure>

<style>
  .change-bars {
    min-width: 0;
    margin: 0;
  }

  h4 {
    margin: 0 0 var(--space-1);
    font-size: var(--text-base);
  }

  figcaption p {
    max-width: 65ch;
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
  }

  .rows {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .rows li {
    display: grid;
    grid-template-columns: minmax(4rem, 9rem) 1fr 4.5rem;
    align-items: center;
    gap: var(--space-2);
  }

  .token {
    display: flex;
    min-width: 0;
  }

  .bar {
    height: 0.75rem;
    overflow: hidden;
    background: var(--color-border);
    border-radius: var(--radius-pill);
  }

  .fill {
    display: block;
    min-width: 2px;
    height: 100%;
    background: var(--color-accent);
    border-radius: inherit;
    transition: width var(--duration-base) ease;
  }

  .value {
    text-align: end;
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
    color: var(--color-text-muted);
  }
</style>
