<!--
  Embeddings (FR-015, US2-1): every token becomes a vector of nEmbd numbers. For each token up to
  the current step: its chip and three strips, the token embedding (what the token is), the
  position embedding (where it stands) and their sum (what block 1 receives). Choosing a token
  opens its exact values. The data loads when the view first opens, not with the page.
-->
<script lang="ts">
  import ShowDetails from '../components/ShowDetails.svelte';
  import Term from '../components/Term.svelte';
  import { createTermRegistry } from '../components/termRegistry';
  import TokenChip from '../components/TokenChip.svelte';
  import VectorStrip from '../components/VectorStrip.svelte';
  import VectorTable from '../components/VectorTable.svelte';
  import ViewIntro from '../components/ViewIntro.svelte';
  import { buildEmbeddingVectors, type EmbeddingVectors } from '../lib/data/embeddings';
  import { t } from '../lib/i18n/index';
  import { modelConfig } from '../lib/model/config';
  import { duration } from '../lib/motion';
  import { viewState } from '../lib/state/viewState.svelte';
  import type { ViewProps } from './types';

  let { view, run, step }: ViewProps = $props();

  createTermRegistry();
  const headingId = $props.id();

  /** Vectors for the whole run, loaded once per run; each step shows a prefix of them. */
  let all = $state.raw<EmbeddingVectors[] | null>(null);
  let failed = $state(false);
  let attempt = $state(0);

  $effect(() => {
    void attempt;
    if (!run) return;
    let cancelled = false;
    all = null;
    failed = false;
    buildEmbeddingVectors(run, run.steps).then(
      (vectors) => {
        if (!cancelled) all = vectors;
      },
      (error) => {
        console.error(error);
        if (!cancelled) failed = true;
      },
    );
    return () => {
      cancelled = true;
    };
  });

  const rows = $derived(
    run && all
      ? all.slice(0, run.nInput + step).map((v) => {
          let scale = 0;
          for (const vec of [v.token, v.position_, v.sum]) {
            for (const x of vec) if (Math.abs(x) > scale) scale = Math.abs(x);
          }
          return {
            vectors: v,
            scale,
            token: run.tokens[v.position]!,
            origin: v.position < run.nInput ? ('input' as const) : ('generated' as const),
          };
        })
      : [],
  );

  let selected = $state(0);
  let detailsOpen = $state(false);

  $effect(() => {
    // Going back a step can remove the chosen token; fall back to the first one.
    if (run && selected >= run.nInput + step) selected = 0;
  });

  function choose(position: number): void {
    selected = position;
    detailsOpen = true;
  }

  /** The strips grow out of their token, left to right (FR-036: instant with reduced motion). */
  function flow(_node: Element, { index }: { index: number }) {
    return {
      delay: duration(Math.min(index * 12, 300)),
      duration: duration(380),
      // A reveal, not a fade: text keeps its full contrast while it animates.
      css: (p: number) => `clip-path: inset(0 ${(1 - p) * 100}% 0 0);`,
    };
  }
</script>

<section class="view" data-view={view} aria-labelledby={headingId}>
  <ViewIntro {view} {headingId} />

  {#if run}
    <p class="term-line"><Term id="embedding" /></p>
    <p class="hint muted">{t('embeddings.size', { d: modelConfig.nEmbd })}</p>

    {#if failed}
      <div class="load-error" role="alert" data-embeddings-error>
        <p>{t('embeddings.load_error')}</p>
        <button type="button" onclick={() => attempt++}>{t('action.retry')}</button>
      </div>
    {:else if !all}
      <p class="status" role="status">{t('status.loading')}</p>
    {:else}
      <div class="panel vectors">
        <p class="legend muted" data-strip-legend>
          <span class="swatch neg" aria-hidden="true"></span>{t('embeddings.legend.negative')}
          <span class="swatch zero" aria-hidden="true"></span>{t('embeddings.legend.zero')}
          <span class="swatch pos" aria-hidden="true"></span>{t('embeddings.legend.positive')}
        </p>
        <ol class="rows" aria-label={t('embeddings.list')}>
          {#each rows as row, i (row.vectors.position)}
            {@const position = row.vectors.position}
            <li class="row" data-embedding-row data-position={position}>
              <button
                type="button"
                class="select"
                aria-pressed={selected === position}
                data-select-token
                onclick={() => choose(position)}
              >
                <TokenChip
                  token={row.token}
                  {position}
                  theme={viewState.resolvedTheme}
                  origin={row.origin}
                  highlighted={selected === position}
                />
              </button>
              <div class="strips" in:flow|global={{ index: i }}>
                <VectorStrip
                  kind="token"
                  values={row.vectors.token}
                  scale={row.scale}
                  label={t('embeddings.strip.token')}
                  theme={viewState.resolvedTheme}
                />
                <VectorStrip
                  kind="position"
                  values={row.vectors.position_}
                  scale={row.scale}
                  label={t('embeddings.strip.position')}
                  theme={viewState.resolvedTheme}
                />
                <VectorStrip
                  kind="sum"
                  values={row.vectors.sum}
                  scale={row.scale}
                  label={t('embeddings.strip.sum')}
                  theme={viewState.resolvedTheme}
                />
              </div>
              {#if selected === position}
                <div class="details">
                  <ShowDetails bind:open={detailsOpen}>
                    <VectorTable token={row.token} origin={row.origin} vectors={row.vectors} />
                  </ShowDetails>
                </div>
              {/if}
            </li>
          {/each}
        </ol>
      </div>
    {/if}
  {/if}
</section>

<style>
  .term-line,
  .hint {
    max-width: 65ch;
  }

  .hint {
    font-size: var(--text-sm);
  }

  .vectors {
    padding: var(--space-4);
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    margin: 0 0 var(--space-3);
    font-size: var(--text-xs);
  }

  .swatch {
    display: inline-block;
    width: 1.25em;
    height: 0.75em;
    margin-inline-start: var(--space-2);
    border-radius: 2px;
    outline: 1px solid var(--color-panel-border);
  }

  .swatch:first-child {
    margin-inline-start: 0;
  }

  .swatch.neg {
    background: rgb(96 165 255);
  }

  .swatch.zero {
    background: rgb(42 52 84);
  }

  .swatch.pos {
    background: rgb(255 146 64);
  }

  .rows {
    display: grid;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row {
    display: grid;
    grid-template-columns: minmax(6rem, 10rem) 1fr;
    align-items: start;
    gap: var(--space-2) var(--space-4);
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-panel-border);
  }

  .row:first-child {
    padding-top: 0;
    border-top: 0;
  }

  .select {
    justify-self: start;
    display: flex;
    max-width: 100%;
    padding: 0;
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
  }

  .strips {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }

  .details {
    grid-column: 1 / -1;
    color: var(--color-text);
  }

  .load-error {
    padding: var(--space-4);
    background: var(--color-danger-surface);
    border: 1px solid var(--color-danger);
    border-radius: var(--radius-md);
  }

  .load-error button {
    min-height: 2.5rem;
    padding: var(--space-1) var(--space-4);
    font-weight: 600;
    color: var(--color-accent-contrast);
    background: var(--color-accent);
    border: 0;
    border-radius: var(--radius-pill);
  }

  @media (max-width: 30rem) {
    .row {
      grid-template-columns: 1fr;
    }
  }
</style>
