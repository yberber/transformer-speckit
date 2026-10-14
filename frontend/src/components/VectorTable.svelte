<!--
  Exact values of one token's three embedding vectors, one row per dimension (FR-015, FR-038). All
  nEmbd rows are in the table, but only the rows in view are rendered (fixed row height, spacer
  rows above and below), so a 768-row table stays cheap. aria-rowcount/aria-rowindex tell
  assistive technology the real size. The scroll box is focusable, so the keyboard scrolls it.
-->
<script lang="ts">
  import type { EmbeddingVectors } from '../lib/data/embeddings';
  import type { Token } from '../lib/data/runData';
  import { t } from '../lib/i18n/index';
  import { formatNumber } from '../lib/i18n/format';
  import { tokenLabel } from '../lib/tokens/describe';

  let {
    token,
    origin,
    vectors,
  }: {
    token: Token;
    origin: 'input' | 'generated';
    vectors: EmbeddingVectors;
  } = $props();

  const ROW_HEIGHT = 32;
  const OVERSCAN = 6;

  let scrollTop = $state(0);
  let viewport = $state(0);

  const count = $derived(vectors.token.length);
  const first = $derived(Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN));
  const last = $derived(Math.min(count, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN));
  const visible = $derived(Array.from({ length: Math.max(0, last - first) }, (_, i) => first + i));

  const sig6 = (v: number) =>
    formatNumber(v, { minimumSignificantDigits: 6, maximumSignificantDigits: 6 });
  const name = $derived(tokenLabel(token, vectors.position, origin));
</script>

<!-- A scrolling region must be focusable, so keyboard users can scroll it (WCAG 2.1.1). -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="scroll"
  role="region"
  aria-label={t('vector_table.label', { token: name })}
  tabindex="0"
  data-vector-scroll
  bind:clientHeight={viewport}
  onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}
>
  <table aria-rowcount={count + 1} data-vector-table data-position={vectors.position}>
    <caption>{t('vector_table.caption', { count, token: name })}</caption>
    <thead>
      <tr aria-rowindex={1}>
        <th scope="col">{t('vector_table.col.dimension')}</th>
        <th scope="col">{t('vector_table.col.token')}</th>
        <th scope="col">{t('vector_table.col.position')}</th>
        <th scope="col">{t('vector_table.col.sum')}</th>
      </tr>
    </thead>
    <tbody>
      {#if first > 0}
        <tr class="spacer" aria-hidden="true" style:height="{first * ROW_HEIGHT}px">
          <td colspan="4"></td>
        </tr>
      {/if}
      {#each visible as i (i)}
        <tr aria-rowindex={i + 2} data-dimension={i}>
          <th scope="row" class="num">{i + 1}</th>
          <td class="num" data-col="token">{sig6(vectors.token[i]!)}</td>
          <td class="num" data-col="position">{sig6(vectors.position_[i]!)}</td>
          <td class="num" data-col="sum">{sig6(vectors.sum[i]!)}</td>
        </tr>
      {/each}
      {#if last < count}
        <tr class="spacer" aria-hidden="true" style:height="{(count - last) * ROW_HEIGHT}px">
          <td colspan="4"></td>
        </tr>
      {/if}
    </tbody>
  </table>
</div>

<style>
  .scroll {
    max-height: 24rem;
    overflow: auto;
    overscroll-behavior: contain;
    background: var(--color-surface);
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

  thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--color-surface-raised);
  }

  tr {
    height: 32px;
  }

  th,
  td {
    padding: 0 var(--space-3);
    text-align: end;
    white-space: nowrap;
    border-top: 1px solid var(--color-border);
  }

  thead th:first-child,
  tbody th {
    text-align: start;
  }

  tbody th {
    font-weight: 400;
    color: var(--color-text-muted);
  }

  .spacer td {
    padding: 0;
    border: 0;
  }
</style>
