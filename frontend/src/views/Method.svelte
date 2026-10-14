<!--
  How we calculate (FR-028, US8-1/2): the counting assumptions, then one section per formula in
  the FORMULAS registry, addressed by its formula id (FR-027). Each section gives the expression,
  its named inputs with where each value comes from, and a worked GPT-2 small example for the
  current text. Every worked value comes from params.ts, flops.ts or kvcache.ts through the
  registry, the same functions the rest of the site uses.
-->
<script lang="ts">
  import rawConfig from '../generated/gpt2-config.json';
  import Term from '../components/Term.svelte';
  import { createTermRegistry } from '../components/termRegistry';
  import ViewIntro from '../components/ViewIntro.svelte';
  import { loadIndex } from '../lib/data/exampleSource';
  import { glossary, t, type MessageKey } from '../lib/i18n/index';
  import { formatBytes, formatNumber } from '../lib/i18n/format';
  import { modelConfig } from '../lib/model/config';
  import {
    FORMULA_LIST,
    INPUT_SYMBOLS,
    generatedTokens,
    inputLabelKey,
    inputValue,
    isConfigInput,
    substitute,
    type Formula,
    type FormulaGroup,
    type FormulaInput,
    type FormulaVariant,
    type WorkedArgs,
  } from '../lib/model/formulas';
  import { reducedMotion } from '../lib/motion';
  import type { ViewProps } from './types';

  let { view, run, step }: ViewProps = $props();

  createTermRegistry();
  const uid = $props.id();
  const headingId = `${uid}-heading`;

  /** Worked examples for the current text; before a run is loaded, the shortest valid one. */
  const args = $derived<WorkedArgs>(run ? { n: run.nInput, t: run.nInput + step } : { n: 1, t: 1 });

  const fmt = (n: number) => formatNumber(n);
  const flops = $derived(glossary('flops').term);

  // --- assumptions ------------------------------------------------------------------------

  /** HF GPT-2 semantics: n_inner = null means an MLP of 4 · n_embd (config.ts). */
  const innerFromDefault = (rawConfig as Record<string, unknown>).n_inner == null;

  const assumptions = $derived.by((): string[] => {
    const keys: MessageKey[] = [
      'method.assumption.forward',
      'method.assumption.madd',
      'method.assumption.matmuls',
      'method.assumption.excluded',
      'method.assumption.lookup',
      'method.assumption.pos_add',
      'method.assumption.causal',
      'method.assumption.lm_head',
      'method.assumption.phases',
    ];
    const list = keys.map((k) => t(k));
    list.push(
      t('method.assumption.heads', { h: fmt(modelConfig.nHead), d: fmt(modelConfig.nEmbd) }),
    );
    list.push(t('method.assumption.float32'));
    if (innerFromDefault) list.push(t('method.assumption.n_inner', { f: fmt(modelConfig.nInner) }));
    if (modelConfig.tieWordEmbeddings) list.push(t('method.assumption.tied'));
    return list;
  });

  /** Links to the pinned model revision and library version of the example data. */
  let model = $state.raw<{ id: string; revision: string; transformers: string | null } | null>(
    null,
  );
  loadIndex().then(
    (index) =>
      (model = {
        id: index.model.id,
        revision: index.model.revision,
        transformers: index.model.versions?.transformers ?? null,
      }),
    () => {},
  );

  const HF_CODE = 'src/transformers/models/gpt2/modeling_gpt2.py';
  const codeHref = $derived(
    `https://github.com/huggingface/transformers/blob/${
      model?.transformers ? `v${model.transformers}` : 'main'
    }/${HF_CODE}`,
  );
  const configHref = $derived(
    model ? `https://huggingface.co/${model.id}/blob/${model.revision}/config.json` : null,
  );

  // --- formulas ---------------------------------------------------------------------------

  const GROUPS: FormulaGroup[] = ['params', 'flops', 'memory'];
  const byGroup = (g: FormulaGroup) => FORMULA_LIST.filter((f) => f.group === g);

  /** `data-variant` of a variant: prefill, decode, weight, bias, or "value" for a single one. */
  const variantName = (v: FormulaVariant) => v.labelKey?.split('.').pop() ?? 'value';

  function showInput(input: FormulaInput, a: WorkedArgs): string {
    return fmt(inputValue(modelConfig, input, a));
  }

  function unit(f: Formula): string {
    if (f.group === 'params') return t('method.unit.params');
    if (f.group === 'flops') return flops;
    return t('method.unit.bytes');
  }

  // --- focus the formula named in the fragment (on load and when it changes) --------------

  let root: HTMLElement | undefined = $state();

  function focusTarget(): void {
    let id: string;
    try {
      id = decodeURIComponent(location.hash.slice(1));
    } catch {
      return;
    }
    if (!id || !root) return;
    const target = document.getElementById(id);
    if (!target || !root.contains(target)) return;
    target.scrollIntoView({ block: 'start', behavior: reducedMotion.current ? 'auto' : 'smooth' });
    target.focus({ preventScroll: true });
  }

  $effect(() => {
    if (!root) return;
    focusTarget();
    addEventListener('hashchange', focusTarget);
    return () => removeEventListener('hashchange', focusTarget);
  });
</script>

<section class="view" data-view={view} aria-labelledby={headingId} bind:this={root}>
  <ViewIntro {view} {headingId} />

  <ul class="terms">
    <li><Term id="flops" /></li>
    <li><Term id="prefill" /></li>
    <li><Term id="decode" /></li>
    <li><Term id="kv-cache" /></li>
  </ul>

  <p class="args" data-method-args data-n={args.n} data-t={args.t}>
    {run
      ? t('method.args.current', { n: args.n, t: args.t, count: generatedTokens(args) })
      : t('method.args.fallback', { n: args.n, t: args.t })}
  </p>

  <section class="assumptions surface" aria-labelledby="{uid}-assumptions" data-assumptions>
    <h3 id="{uid}-assumptions">{t('method.assumptions.title')}</h3>
    <p>{t('method.assumptions.intro')}</p>
    <ul>
      {#each assumptions as text, i (i)}
        <li>{text}</li>
      {/each}
    </ul>
    <p class="sources muted">
      {t('method.sources')}
      <a href={codeHref} rel="noopener" data-source="code"
        >{model?.transformers
          ? t('method.source.code', { version: model.transformers })
          : t('method.source.code_latest')}</a
      >{#if configHref}<span class="sep" aria-hidden="true">·</span><a
          href={configHref}
          rel="noopener"
          data-source="config">{t('method.source.config')}</a
        >{/if}
    </p>
  </section>

  {#each GROUPS as group (group)}
    <section class="group" aria-labelledby="{uid}-{group}" data-formula-group={group}>
      <h3 id="{uid}-{group}">{t(`method.group.${group}.title`)}</h3>
      <p class="muted group-intro">{t(`method.group.${group}.intro`)}</p>

      {#each byGroup(group) as f (f.id)}
        <section
          id={f.id}
          class="formula surface"
          tabindex="-1"
          aria-labelledby="{uid}-{f.id}"
          data-formula={f.id}
        >
          <header class="formula-head">
            <h4 id="{uid}-{f.id}">{t(f.titleKey)}</h4>
            <span class="badge" class:exact={!f.isEstimate}>
              {f.isEstimate ? t('estimate.badge') : t('method.formula.exact')}
            </span>
          </header>
          {#if f.perLayer}
            <p class="note muted">
              {t('method.formula.per_layer', { n: fmt(modelConfig.nLayer) })}
            </p>
          {/if}

          <h5>{t('method.formula.expression')}</h5>
          <dl class="variants">
            {#each f.variants as v (v.expression + variantName(v))}
              {@const value = v.worked(modelConfig, args)}
              {@const filled = substitute(v.expression, (input) => showInput(input, args))}
              <div class="variant" data-variant={variantName(v)}>
                {#if v.labelKey}
                  <dt>{t(v.labelKey)}</dt>
                {:else}
                  <dt class="visually-hidden">{t(f.titleKey)}</dt>
                {/if}
                <dd>
                  <code class="expression" data-expression>{v.expression}</code>
                  <span class="worked">
                    <span class="visually-hidden">{t('method.formula.worked')}:</span>
                    <!-- A lone symbol needs no filled-in line: it would only repeat the result. -->
                    {#if filled !== fmt(value)}
                      <code class="substituted">{filled}</code>
                    {/if}
                    <span class="equals">
                      =
                      <span class="num result" data-worked-value data-value={value}
                        >{fmt(value)}</span
                      >
                      <span class="unit" lang={f.group === 'flops' ? 'en' : undefined}
                        >{unit(f)}</span
                      >
                      {#if f.group === 'memory'}
                        <span class="muted">({formatBytes(value)})</span>
                      {/if}
                    </span>
                  </span>
                </dd>
              </div>
            {/each}
          </dl>
          {#if f.id === 'params-lm_head' && modelConfig.tieWordEmbeddings}
            <p class="note">{t('method.formula.lm_head_tied')}</p>
          {/if}
          {#if f.id === 'flops-running-total'}
            <p class="note muted">{t('method.formula.running_note')}</p>
          {/if}

          <h5>{t('method.formula.inputs')}</h5>
          <dl class="inputs" data-inputs>
            {#each f.inputs as input (input)}
              <div data-input-key={input}>
                <dt>
                  <code>{INPUT_SYMBOLS[input]}</code> =
                  <span class="num">{showInput(input, args)}</span>
                </dt>
                <dd>
                  {t(inputLabelKey(input))}
                  <span class="muted">
                    ({isConfigInput(input)
                      ? t('method.source.from_config', { key: input })
                      : t('method.source.from_text')})
                  </span>
                </dd>
              </div>
            {/each}
          </dl>
        </section>
      {/each}
    </section>
  {/each}
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

  .args {
    max-width: 65ch;
    margin: 0 0 var(--space-5);
  }

  .assumptions {
    max-width: 52rem;
    padding: var(--space-4);
  }

  .assumptions h3 {
    margin: 0 0 var(--space-2);
  }

  .assumptions p {
    margin: 0 0 var(--space-2);
  }

  .assumptions ul {
    display: grid;
    gap: var(--space-2);
    max-width: 65ch;
    margin: 0 0 var(--space-3);
    padding-inline-start: var(--space-5);
  }

  .sources {
    font-size: var(--text-sm);
  }

  .sep {
    margin-inline: 0.5em;
  }

  .sources a {
    color: var(--color-accent);
    text-underline-offset: 0.15em;
  }

  .group {
    margin-top: var(--space-7);
  }

  .group h3 {
    margin: 0 0 var(--space-1);
  }

  .group-intro {
    max-width: 65ch;
    margin: 0 0 var(--space-4);
  }

  .formula {
    display: grid;
    gap: var(--space-2);
    max-width: 52rem;
    margin-bottom: var(--space-4);
    padding: var(--space-4);
    scroll-margin-top: var(--space-4);
  }

  /* The formula a link pointed to is marked, also after a pointer click. */
  .formula:focus {
    outline: var(--focus-width) solid var(--color-focus);
    outline-offset: 2px;
  }

  .formula-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-1) var(--space-3);
  }

  h4 {
    margin: 0;
    font-size: var(--text-lg);
  }

  h5 {
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .badge {
    padding: 0.1em 0.6em;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    white-space: nowrap;
    border: 1px dashed var(--color-border-strong);
    border-radius: var(--radius-pill);
  }

  .badge.exact {
    border-style: solid;
  }

  .note {
    max-width: 65ch;
    margin: 0;
    font-size: var(--text-sm);
  }

  dl {
    display: grid;
    gap: var(--space-2);
    margin: 0;
  }

  .variant dt {
    font-weight: 600;
  }

  .variant dd {
    display: grid;
    gap: var(--space-1);
    margin: 0;
  }

  .expression {
    font-size: var(--text-lg);
    overflow-wrap: anywhere;
  }

  .worked {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-2);
  }

  .substituted {
    color: var(--color-text-muted);
    overflow-wrap: anywhere;
  }

  .equals {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-2);
  }

  .result {
    font-weight: 700;
  }

  .unit {
    color: var(--color-text-muted);
  }

  .inputs div {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
  }

  .inputs dt {
    min-width: 9rem;
    font-weight: 600;
  }

  .inputs dd {
    flex: 1 1 18rem;
    margin: 0;
  }
</style>
