<!--
  Prediction (FR-018): the ten most likely next tokens at the current step, most likely first,
  each with a bar on a 0–100 % scale and its probability. The top candidate is what greedy
  decoding appends; it is marked with a text badge, not by color alone. Exact probabilities are
  in the details table. "Next token" is in the generation controls the App shows above the view.
-->
<script lang="ts">
  import ShowDetails from '../components/ShowDetails.svelte';
  import Term from '../components/Term.svelte';
  import { createTermRegistry } from '../components/termRegistry';
  import TokenChip from '../components/TokenChip.svelte';
  import TokenSequence from '../components/TokenSequence.svelte';
  import ViewIntro from '../components/ViewIntro.svelte';
  import { predictionAt } from '../lib/data/runData';
  import { t } from '../lib/i18n/index';
  import { formatNumber } from '../lib/i18n/format';
  import { viewState } from '../lib/state/viewState.svelte';
  import { spokenText } from '../lib/tokens/describe';
  import { SPACE_MARKER, tokenDisplay } from '../lib/tokens/display';
  import type { ViewProps } from './types';

  let { view, run, step }: ViewProps = $props();

  createTermRegistry();
  const headingId = $props.id();

  /** Where the chosen token will go, so each candidate shows the color it would get there. */
  const nextPosition = $derived(run ? run.nInput + step : 0);
  const candidates = $derived(
    run
      ? predictionAt(run, step).candidates.map((c, i) => {
          const display = tokenDisplay(c.bytes, c.id);
          return {
            rank: i + 1,
            candidate: c,
            display,
            text: display.leadingSpace ? SPACE_MARKER + display.text : display.text,
          };
        })
      : [],
  );
  const share = $derived(candidates.reduce((sum, c) => sum + c.candidate.prob, 0));

  const percent = (p: number) =>
    formatNumber(p, { style: 'percent', minimumSignificantDigits: 3, maximumSignificantDigits: 3 });
  const exact = (p: number) =>
    formatNumber(p, { minimumSignificantDigits: 7, maximumSignificantDigits: 7 });
</script>

<section class="view" data-view={view} aria-labelledby={headingId}>
  <ViewIntro {view} {headingId} />

  {#if run}
    <ul class="terms">
      <li><Term id="logit" /></li>
      <li><Term id="probability-distribution" /></li>
    </ul>

    <div class="panel context">
      <h3 class="panel-title">{t('prediction.context')}</h3>
      <TokenSequence {run} {step} theme={viewState.resolvedTheme} label={t('prediction.context')} />
    </div>

    <h3 id="{headingId}-candidates">{t('prediction.candidates')}</h3>
    <p class="hint muted">{t('prediction.greedy_hint')}</p>

    <ol class="candidates" aria-labelledby="{headingId}-candidates" data-candidates>
      {#each candidates as c (c.candidate.id)}
        <li
          class:greedy={c.rank === 1}
          data-token-id={c.candidate.id}
          data-greedy={c.rank === 1 ? 'true' : undefined}
        >
          <span class="rank num" aria-hidden="true">{c.rank}</span>
          <span class="label">
            <span aria-hidden="true">
              <TokenChip
                token={c.candidate}
                position={nextPosition}
                theme={viewState.resolvedTheme}
                origin="generated"
              />
            </span>
            <span class="visually-hidden">{spokenText(c.display)}</span>
            {#if c.rank === 1}
              <span class="badge" data-greedy-badge>{t('prediction.greedy')}</span>
            {/if}
          </span>
          <span class="bar" aria-hidden="true">
            <span class="fill" style:width="{c.candidate.prob * 100}%"></span>
          </span>
          <span class="pct num">{percent(c.candidate.prob)}</span>
        </li>
      {/each}
    </ol>

    <p class="share muted">{t('prediction.share', { share: percent(share) })}</p>

    <ShowDetails>
      <!-- A scrolling region must be focusable, so keyboard users can scroll it (WCAG 2.1.1). -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        class="scroll-x table-wrap"
        role="region"
        aria-label={t('prediction.table')}
        tabindex="0"
      >
        <table data-candidate-table>
          <caption>{t('prediction.table_caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('prediction.col.rank')}</th>
              <th scope="col">{t('prediction.col.id')}</th>
              <th scope="col">{t('prediction.col.token')}</th>
              <th scope="col">{t('prediction.col.prob')}</th>
            </tr>
          </thead>
          <tbody>
            {#each candidates as c (c.candidate.id)}
              <tr>
                <th scope="row" class="num">{c.rank}</th>
                <td class="num" data-col="id">{c.candidate.id}</td>
                <td data-col="token">
                  {#if c.display.kind === 'eos'}
                    <code>{c.display.text}</code> <span class="muted">({t('token.eos')})</span>
                  {:else}
                    <code class="exact">{c.text}</code>
                  {/if}
                </td>
                <td class="num" data-col="prob">{exact(c.candidate.prob)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </ShowDetails>
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

  .context {
    padding: var(--space-4);
  }

  .panel-title {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-panel-muted);
  }

  h3 {
    margin: var(--space-5) 0 var(--space-1);
    font-size: var(--text-lg);
  }

  .hint {
    max-width: 65ch;
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
  }

  .candidates {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .candidates li {
    display: grid;
    grid-template-columns: 2ch minmax(6rem, 14rem) 1fr 4.5rem;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .candidates li.greedy {
    border: 2px solid var(--color-accent);
    background: var(--color-accent-soft);
  }

  .rank {
    color: var(--color-text-muted);
    text-align: end;
  }

  .label {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .badge {
    padding: 0 var(--space-2);
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-accent-contrast);
    background: var(--color-accent);
    border-radius: var(--radius-pill);
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
  }

  .pct {
    text-align: end;
  }

  .share {
    max-width: 65ch;
    margin-top: var(--space-3);
    font-size: var(--text-sm);
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

  /* Narrow screens: the bar moves to its own row under the token and percentage. */
  @media (max-width: 30rem) {
    .candidates li {
      grid-template-columns: 2ch 1fr auto;
    }

    .bar {
      grid-column: 2 / -1;
      grid-row: 2;
    }

    .pct {
      grid-row: 1;
      grid-column: 3;
    }
  }
</style>
