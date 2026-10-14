<!--
  Tokenization (FR-014): the text split into tokens, each in its own color, with visible markers
  for spaces and line breaks. The details table lists every token's ID, exact text and origin;
  tokens that hold only part of a character show their byte values.
-->
<script lang="ts">
  import ShowDetails from '../components/ShowDetails.svelte';
  import Term from '../components/Term.svelte';
  import { createTermRegistry } from '../components/termRegistry';
  import TokenSequence from '../components/TokenSequence.svelte';
  import ViewIntro from '../components/ViewIntro.svelte';
  import { tokensAt } from '../lib/data/runData';
  import { t } from '../lib/i18n/index';
  import { viewState } from '../lib/state/viewState.svelte';
  import { SPACE_MARKER, tokenDisplay } from '../lib/tokens/display';
  import type { ViewProps } from './types';

  let { view, run, step }: ViewProps = $props();

  createTermRegistry();
  const headingId = $props.id();

  const rows = $derived(
    run
      ? tokensAt(run, step).map((token, position) => {
          const display = tokenDisplay(token.bytes, token.id);
          return {
            position,
            token,
            display,
            text: display.leadingSpace ? SPACE_MARKER + display.text : display.text,
            origin: position < run.nInput ? ('input' as const) : ('generated' as const),
          };
        })
      : [],
  );
  const hasPartial = $derived(rows.some((r) => r.display.kind === 'partial'));
</script>

<section class="view" data-view={view} aria-labelledby={headingId}>
  <ViewIntro {view} {headingId} />

  {#if run}
    <p class="term-line"><Term id="token" /></p>

    <div class="panel sequence">
      <TokenSequence {run} {step} theme={viewState.resolvedTheme} label={t('tokens.sequence')} />
      <p class="summary muted">
        {t('tokens.summary', { count: rows.length, input: run.nInput, generated: step })}
      </p>
    </div>

    {#if hasPartial}
      <p class="partial-note" data-partial-note>{t('tokens.partial_note')}</p>
    {/if}

    <ShowDetails>
      <!-- A scrolling region must be focusable, so keyboard users can scroll it (WCAG 2.1.1). -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="scroll-x table-wrap" role="region" aria-label={t('tokens.table')} tabindex="0">
        <table data-token-table>
          <caption>{t('tokens.table_caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('tokens.col.position')}</th>
              <th scope="col">{t('tokens.col.id')}</th>
              <th scope="col">{t('tokens.col.text')}</th>
              <th scope="col">{t('tokens.col.bytes')}</th>
              <th scope="col">{t('tokens.col.origin')}</th>
            </tr>
          </thead>
          <tbody>
            {#each rows as row (row.position)}
              <tr>
                <th scope="row" class="num">{row.position + 1}</th>
                <td class="num" data-col="id">{row.token.id}</td>
                <td data-col="text">
                  {#if row.display.kind === 'eos'}
                    <code>{row.display.text}</code> <span class="muted">({t('token.eos')})</span>
                  {:else}
                    <code class="exact">{row.text}</code>
                  {/if}
                </td>
                <td class="num" data-col="bytes">
                  {#if row.display.kind === 'partial'}{row.display.hex}{/if}
                </td>
                <td data-col="origin">{t(`tokens.origin.${row.origin}`)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </ShowDetails>
  {/if}
</section>

<style>
  .term-line {
    max-width: 65ch;
  }

  .sequence {
    padding: var(--space-4);
  }

  .summary {
    margin: var(--space-3) 0 0;
    font-size: var(--text-sm);
  }

  .partial-note {
    max-width: 65ch;
    margin-top: var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
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

  .exact {
    white-space: pre;
  }
</style>
