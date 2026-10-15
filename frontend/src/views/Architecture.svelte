<!--
  Architecture (FR-019, US3-1..4): a hand-drawn map of the whole model in which every weight
  matrix and bias can be selected. The panel shows its name, shape, parameter count and share of
  all parameters, computed from the model config by params.ts (tested against the real
  state_dict and the hand references). The tied LM head is explained and counted once. "Show it in
  action" jumps to the view where that part is at work, at the chosen layer.
-->
<script lang="ts">
  import LayerSelector from '../components/LayerSelector.svelte';
  import MoreTerms from '../components/MoreTerms.svelte';
  import ShowDetails from '../components/ShowDetails.svelte';
  import Term from '../components/Term.svelte';
  import { createTermRegistry } from '../components/termRegistry';
  import ViewIntro from '../components/ViewIntro.svelte';
  import { glossary, t, type MessageKey } from '../lib/i18n/index';
  import { formatCompact, formatNumber, formatPercent } from '../lib/i18n/format';
  import { activationLabelKey, modelConfig } from '../lib/model/config';
  import {
    paramGroups,
    perBlockParams,
    totalParams,
    type ParamComponent,
    type ParamGroup,
    type ParamKind,
  } from '../lib/model/params';
  import { reducedMotion } from '../lib/motion';
  import { methodHref, openFormula } from '../lib/state/methodLink';
  import { viewState, type ViewId } from '../lib/state/viewState.svelte';
  import type { ViewProps } from './types';

  let { view }: ViewProps = $props();

  createTermRegistry();
  const uid = $props.id();
  const headingId = `${uid}-heading`;

  const groups = paramGroups(modelConfig);
  const total = totalParams(modelConfig);
  const perBlock = perBlockParams(modelConfig);
  const layer = $derived(viewState.layer);

  // --- selection --------------------------------------------------------------------------

  /** Selected part, by component and kind, so it follows the layer selector. */
  let selected = $state<{ component: ParamComponent; kind: ParamKind } | null>(null);

  function groupFor(component: ParamComponent, kind: ParamKind, l: number): ParamGroup {
    return groups.find(
      (g) => g.component === component && g.kind === kind && (g.layer === null || g.layer === l),
    )!;
  }

  const current = $derived(selected ? groupFor(selected.component, selected.kind, layer) : null);

  let panel: HTMLElement | undefined = $state();
  const wide = typeof matchMedia === 'function' ? matchMedia('(min-width: 52rem)') : null;

  function select(component: ParamComponent, kind: ParamKind, byPointer: boolean): void {
    selected = { component, kind };
    // On narrow screens the panel sits below the diagram: bring it into view after a tap.
    if (byPointer && panel && !wide?.matches) {
      const rect = panel.getBoundingClientRect();
      if (rect.top > innerHeight || rect.bottom < 0) {
        panel.scrollIntoView({
          block: 'nearest',
          behavior: reducedMotion.current ? 'auto' : 'smooth',
        });
      }
    }
  }

  function onChipKey(e: KeyboardEvent, component: ParamComponent, kind: ParamKind): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      select(component, kind, false);
    }
  }

  // --- text -------------------------------------------------------------------------------

  const fmt = (n: number) => formatNumber(n);
  const sizeParams = $derived({
    d: fmt(modelConfig.nEmbd),
    f: fmt(modelConfig.nInner),
    v: fmt(modelConfig.vocabSize),
    p: fmt(modelConfig.nPositions),
    activation: t(activationLabelKey() as MessageKey),
  });

  /** i18n-safe id of a component: `attn.c_attn` → `attn_c_attn`. */
  const keyId = (c: ParamComponent) => c.replace('.', '_');
  const partTitle = (c: ParamComponent) =>
    t(`architecture.component.${keyId(c)}.title` as MessageKey, sizeParams);
  const partDescription = (c: ParamComponent) =>
    t(`architecture.component.${keyId(c)}.description` as MessageKey, sizeParams);
  const kindLabel = (k: ParamKind) => t(`architecture.kind.${k}`);
  const shapeText = (shape: number[]) => shape.map(fmt).join(' × ');

  function layoutKey(g: ParamGroup): MessageKey {
    if (g.component === 'wte' || g.component === 'wpe' || g.component === 'lm_head') {
      return `architecture.layout.${g.component}`;
    }
    if (g.component === 'ln_1' || g.component === 'ln_2' || g.component === 'ln_f') {
      return 'architecture.layout.norm';
    }
    return g.kind === 'bias' ? 'architecture.layout.bias' : 'architecture.layout.conv1d';
  }

  /** Where the part is at work (US3-4). */
  function actionTarget(g: ParamGroup): { view: ViewId; layer: number | null } {
    switch (g.component) {
      case 'wte':
      case 'wpe':
        return { view: 'embeddings', layer: null };
      case 'attn.c_attn':
      case 'attn.c_proj':
        return { view: 'attention', layer: g.layer };
      case 'lm_head':
        return { view: 'prediction', layer: null };
      // The final layer norm comes right after the last block.
      case 'ln_f':
        return { view: 'blocks', layer: modelConfig.nLayer };
      default:
        return { view: 'blocks', layer: g.layer };
    }
  }

  const target = $derived(current ? actionTarget(current) : null);

  function showInAction(): void {
    if (!target) return;
    if (target.layer !== null) viewState.setLayer(target.layer);
    viewState.setView(target.view);
  }

  const announcement = $derived.by(() => {
    if (!current) return '';
    const base = { name: current.name, shape: shapeText(current.shape), count: fmt(current.count) };
    return current.tiedTo
      ? t('architecture.selected_tied', { ...base, tied: current.tiedTo })
      : t('architecture.selected', { ...base, share: formatPercent(current.share, 3) });
  });

  // --- diagram layout (viewBox units; the SVG scales to the available width) ---------------

  const W = 360;
  const SPINE = 22;
  const CHIP_W = 86;
  const CHIP_H = 22;
  const GAP = 10;

  interface Box {
    component: ParamComponent;
    x0: number;
    x1: number;
    y: number;
    h: number;
    chips: ParamKind[];
    type: 'embedding' | 'norm' | 'attention' | 'mlp' | 'head';
    /** Joins the residual stream at its left edge: 'in' feeds it, 'out' reads from it. */
    stream: 'in' | 'out' | null;
  }

  const TYPE: Record<ParamComponent, Box['type']> = {
    wte: 'embedding',
    wpe: 'embedding',
    ln_1: 'norm',
    'attn.c_attn': 'attention',
    'attn.c_proj': 'attention',
    ln_2: 'norm',
    'mlp.c_fc': 'mlp',
    'mlp.c_proj': 'mlp',
    ln_f: 'norm',
    lm_head: 'head',
  };

  const layout = (() => {
    const boxes: Box[] = [];
    const adds: { y: number; from: number }[] = [];
    let y = 8;
    const input = { y, h: 30 };
    y += input.h + GAP + 6;

    function box(
      component: ParamComponent,
      x0: number,
      x1: number,
      chips: ParamKind[],
      stream: Box['stream'],
      h = chips.length === 2 ? 64 : 52,
    ): Box {
      const b: Box = { component, x0, x1, y, h, chips, type: TYPE[component], stream };
      boxes.push(b);
      y += h + GAP;
      return b;
    }

    const wte = box('wte', 44, 350, ['weight'], 'in');
    box('wpe', 44, 350, ['weight'], 'in');
    const embedAdd = y + 4;
    y += 22;

    const blockTop = y;
    y += 38;
    box('ln_1', 40, 346, ['weight', 'bias'], 'out');
    const attnTop = y;
    y += 26;
    box('attn.c_attn', 50, 336, ['weight', 'bias'], null);
    box('attn.c_proj', 50, 336, ['weight', 'bias'], null);
    const attnBottom = y - GAP + 8;
    y = attnBottom + 14;
    adds.push({ y: y + 4, from: attnBottom });
    y += 22;
    box('ln_2', 40, 346, ['weight', 'bias'], 'out');
    const mlpTop = y;
    y += 26;
    box('mlp.c_fc', 50, 336, ['weight', 'bias'], null);
    const activationY = y + 4;
    y += 20;
    box('mlp.c_proj', 50, 336, ['weight', 'bias'], null);
    const mlpBottom = y - GAP + 8;
    y = mlpBottom + 14;
    adds.push({ y: y + 4, from: mlpBottom });
    y += 22;
    const blockBottom = y;
    y += GAP + 6;

    const lnF = box('ln_f', 44, 350, ['weight', 'bias'], 'out');
    const lmHead = box('lm_head', 44, 350, ['weight'], null, 64);
    y += 6;
    const output = { y, h: 30 };
    y += output.h + 8;

    return {
      height: y,
      boxes,
      adds,
      input,
      output,
      embedAdd,
      block: { top: blockTop, bottom: blockBottom },
      attn: { top: attnTop, bottom: attnBottom },
      mlp: { top: mlpTop, bottom: mlpBottom },
      activationY,
      spine: { top: wte.y + wte.h / 2, bottom: lnF.y + lnF.h / 2 },
      wte,
      lmHead,
      lnF,
    };
  })();

  const mid = (b: { y: number; h: number }) => b.y + b.h / 2;
  const chipX = (b: Box) => b.x1 - 8 - CHIP_W;
  const chipY = (b: Box, i: number) =>
    b.chips.length === 2 ? b.y + 8 + i * (CHIP_H + 4) : b.y + (b.h - CHIP_H) / 2;
  /** Width left for the box's text, before its chips. */
  const textWidth = (b: Box) => chipX(b) - 10 - (b.x0 + 12);
  const center = W / 2 + 16;

  /**
   * SVG text does not wrap: when a translated label is longer than its slot, squeeze it to fit
   * instead of letting it run under the chips. Re-checked when the text or the fonts change.
   */
  function fit(node: SVGTextElement, arg: { max: number; text: string }) {
    let max = arg.max;
    const apply = () => {
      node.removeAttribute('textLength');
      node.removeAttribute('lengthAdjust');
      if (node.getComputedTextLength() > max) {
        node.setAttribute('textLength', String(max));
        node.setAttribute('lengthAdjust', 'spacingAndGlyphs');
      }
    };
    apply();
    void document.fonts?.ready.then(apply);
    return {
      update(next: { max: number; text: string }) {
        max = next.max;
        // The text node updates before this runs.
        queueMicrotask(apply);
      },
    };
  }

  const attentionTerm = $derived(glossary('attention').term);
  const mlpTerm = $derived(glossary('mlp').term);
</script>

<section class="view" data-view={view} aria-labelledby={headingId}>
  <ViewIntro {view} {headingId} />

  <ul class="terms">
    <li><Term id="layer" /></li>
    <li><Term id="attention" /></li>
    <li><Term id="mlp" /></li>
    <li><Term id="embedding" /></li>
  </ul>
  <MoreTerms ids={['token', 'head', 'logit']} />

  <div class="summary surface">
    <p class="total">
      <span class="total-label">{t('architecture.summary.total')}</span>
      <span class="total-value" data-total-params data-value={total}>{formatCompact(total)}</span>
    </p>
    <p class="muted per-block" data-per-block-params data-value={perBlock}>
      {t('architecture.summary.per_block', {
        count: formatCompact(perBlock),
        n: fmt(modelConfig.nLayer),
      })}
    </p>
    <p class="muted note">{t('architecture.summary.total_note')}</p>
    <p class="note">
      <a
        class="formula-link"
        href={methodHref('params-total')}
        data-formula-link="params-total"
        aria-label={t('estimate.how_label', { what: t('architecture.summary.total') })}
        onclick={(e) => openFormula(e, 'params-total')}>{t('estimate.how')}</a
      >
    </p>
    <div data-summary-details>
      <ShowDetails>
        <dl class="exact">
          <div>
            <dt>{t('architecture.summary.exact_total')}</dt>
            <dd class="num" data-exact="total">{fmt(total)}</dd>
          </div>
          <div>
            <dt>{t('architecture.summary.exact_per_block')}</dt>
            <dd class="num" data-exact="per-block">{fmt(perBlock)}</dd>
          </div>
        </dl>
      </ShowDetails>
    </div>
  </div>

  <p class="help">{t('architecture.diagram_help')}</p>
  <LayerSelector />

  <div class="layout">
    <figure class="panel diagram-wrap">
      <svg
        viewBox="0 0 {W} {layout.height}"
        role="group"
        aria-label={t('architecture.diagram_label', { n: fmt(modelConfig.nLayer) })}
        data-architecture-diagram
      >
        <defs>
          <marker
            id="{uid}-arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L8,4 L0,8 z" class="arrowhead" />
          </marker>
        </defs>

        <!-- Connectors and frames: decoration; the parts and their chips carry the content. -->
        <g aria-hidden="true">
          <rect
            class="frame block-frame"
            x="8"
            y={layout.block.top}
            width={W - 14}
            height={layout.block.bottom - layout.block.top}
            rx="12"
          />
          <text class="frame-title" x="40" y={layout.block.top + 23}>
            {t('architecture.block', { n: layer })}
          </text>
          <g class="repeat">
            <rect x={W - 82} y={layout.block.top + 8} width="68" height="22" rx="11" />
            <text x={W - 48} y={layout.block.top + 23} text-anchor="middle" data-repeat-label
              >× {fmt(modelConfig.nLayer)}</text
            >
          </g>

          <rect
            class="frame group-frame"
            x="40"
            y={layout.attn.top}
            width="306"
            height={layout.attn.bottom - layout.attn.top}
            rx="10"
          />
          <text class="group-title" x="52" y={layout.attn.top + 17} lang="en">
            {attentionTerm}
          </text>
          <rect
            class="frame group-frame"
            x="40"
            y={layout.mlp.top}
            width="306"
            height={layout.mlp.bottom - layout.mlp.top}
            rx="10"
          />
          <text class="group-title" x="52" y={layout.mlp.top + 17} lang="en">{mlpTerm}</text>
          <text class="activation" x={193} y={layout.activationY + 8} text-anchor="middle">
            ↓ {sizeParams.activation}
          </text>

          <!-- The residual stream: every block reads from it and adds its updates back. -->
          <line
            class="spine"
            x1={SPINE}
            y1={layout.spine.top}
            x2={SPINE}
            y2={layout.spine.bottom}
          />
          {#each layout.boxes as b (b.component)}
            {#if b.stream === 'in'}
              <line
                class="flow"
                x1={b.x0}
                y1={mid(b)}
                x2={SPINE + 1}
                y2={mid(b)}
                marker-end="url(#{uid}-arrow)"
              />
            {:else if b.stream === 'out'}
              <line
                class="flow"
                x1={SPINE}
                y1={mid(b)}
                x2={b.x0 - 1}
                y2={mid(b)}
                marker-end="url(#{uid}-arrow)"
              />
            {/if}
          {/each}
          <g class="add">
            <circle cx={SPINE} cy={layout.embedAdd + 7} r="9" />
            <text x={SPINE} y={layout.embedAdd + 11.5} text-anchor="middle">+</text>
          </g>
          {#each layout.adds as a (a.y)}
            <path
              class="flow"
              d="M{center} {a.from} V{a.y + 7} H{SPINE + 10}"
              marker-end="url(#{uid}-arrow)"
            />
            <g class="add">
              <circle cx={SPINE} cy={a.y + 7} r="9" />
              <text x={SPINE} y={a.y + 11.5} text-anchor="middle">+</text>
            </g>
          {/each}

          <rect
            class="io"
            x="44"
            y={layout.input.y}
            width="306"
            height={layout.input.h}
            rx={layout.input.h / 2}
          />
          <text class="io-text" x={197} y={layout.input.y + 19.5} text-anchor="middle">
            {t('architecture.io.input')}
          </text>
          <line
            class="flow"
            x1={197}
            y1={layout.input.y + layout.input.h}
            x2={197}
            y2={layout.wte.y - 1}
            marker-end="url(#{uid}-arrow)"
          />
          <line
            class="flow"
            x1={197}
            y1={layout.lnF.y + layout.lnF.h}
            x2={197}
            y2={layout.lmHead.y - 1}
            marker-end="url(#{uid}-arrow)"
          />
          <line
            class="flow"
            x1={197}
            y1={layout.lmHead.y + layout.lmHead.h}
            x2={197}
            y2={layout.output.y - 1}
            marker-end="url(#{uid}-arrow)"
          />
          <rect
            class="io"
            x="44"
            y={layout.output.y}
            width="306"
            height={layout.output.h}
            rx={layout.output.h / 2}
          />
          <text class="io-text" x={197} y={layout.output.y + 19.5} text-anchor="middle">
            {t('architecture.io.output', { v: sizeParams.v })}
          </text>

          <!-- The LM head reuses the token embedding matrix. -->
          <path
            class="tied"
            d="M350 {mid(layout.lmHead)} H356 V{mid(layout.wte)} H351"
            marker-end="url(#{uid}-arrow)"
          />
        </g>

        {#each layout.boxes as b (b.component)}
          <g class="part" data-component={b.component} data-type={b.type}>
            <g aria-hidden="true">
              <rect class="box" x={b.x0} y={b.y} width={b.x1 - b.x0} height={b.h} rx="8" />
              <rect class="stripe" x={b.x0} y={b.y} width="5" height={b.h} rx="2.5" />
              <text class="code" x={b.x0 + 14} y={b.y + 21}>{b.component}</text>
              <text
                class="subtitle"
                x={b.x0 + 14}
                y={b.y + 38}
                use:fit={{ max: textWidth(b), text: partTitle(b.component) }}
                >{partTitle(b.component)}</text
              >
              {#if b.component === 'lm_head' && modelConfig.tieWordEmbeddings}
                <text
                  class="subtitle tied-text"
                  x={b.x0 + 14}
                  y={b.y + 53}
                  use:fit={{ max: textWidth(b), text: t('architecture.tied_short') }}
                  >{t('architecture.tied_short')}</text
                >
              {/if}
            </g>

            {#each b.chips as kind, i (kind)}
              {@const g = groupFor(b.component, kind, layer)}
              {@const isSelected = current?.name === g.name}
              <g
                class="chip"
                class:selected={isSelected}
                role="button"
                tabindex="0"
                aria-pressed={isSelected}
                aria-label={t('architecture.param_label', {
                  kind: kindLabel(kind),
                  name: g.name,
                  part: partTitle(b.component),
                })}
                data-param={g.name}
                onclick={() => select(b.component, kind, true)}
                onkeydown={(e) => onChipKey(e, b.component, kind)}
              >
                <rect
                  class="chip-ring"
                  x={chipX(b) - 3}
                  y={chipY(b, i) - 3}
                  width={CHIP_W + 6}
                  height={CHIP_H + 6}
                  rx="14"
                />
                <rect
                  class="chip-body"
                  x={chipX(b)}
                  y={chipY(b, i)}
                  width={CHIP_W}
                  height={CHIP_H}
                  rx="11"
                />
                <text
                  class="chip-text"
                  x={chipX(b) + CHIP_W / 2}
                  y={chipY(b, i) + 15}
                  text-anchor="middle">{kindLabel(kind)}</text
                >
              </g>
            {/each}
          </g>
        {/each}
      </svg>
    </figure>

    <aside
      class="param-panel surface"
      aria-label={t('architecture.panel.label')}
      data-param-panel
      bind:this={panel}
    >
      {#if current}
        <h3 class="param-name"><code data-field="name">{current.name}</code></h3>
        <p class="part-line">
          <span class="part-title">{partTitle(current.component)}</span>
          <span class="muted">
            · {current.layer === null
              ? t('architecture.panel.outside')
              : t('architecture.block', { n: current.layer })}
          </span>
        </p>
        <dl class="facts">
          <div>
            <dt>{t('architecture.panel.shape')}</dt>
            <dd>
              <span class="num" data-field="shape">{shapeText(current.shape)}</span>
              <span class="layout-note muted">{t(layoutKey(current))}</span>
            </dd>
          </div>
          <div>
            <dt>{t('architecture.panel.count')}</dt>
            <dd class="num" data-field="count">{fmt(current.count)}</dd>
          </div>
          <div>
            <dt>{t('architecture.panel.share')}</dt>
            <dd class:num={!current.tiedTo} data-field="share">
              {current.tiedTo
                ? t('architecture.panel.share_tied', { name: current.tiedTo })
                : formatPercent(current.share, 3)}
            </dd>
          </div>
        </dl>
        <p class="description">{partDescription(current.component)}</p>
        {#if current.tiedTo}
          <p class="tied-note" data-tied-note>
            {t('architecture.tied_note', { name: current.tiedTo })}
          </p>
        {/if}
        <p class="note">
          <a
            class="formula-link"
            href={methodHref(current.formulaId)}
            data-formula-link={current.formulaId}
            aria-label={t('estimate.how_label', { what: current.name })}
            onclick={(e) => current && openFormula(e, current.formulaId)}>{t('estimate.how')}</a
          >
        </p>
        {#if target}
          <button
            type="button"
            class="in-action"
            data-action="show-in-action"
            onclick={showInAction}
          >
            {target.layer === null
              ? t('architecture.show_in_action', { view: t(`view.${target.view}.name`) })
              : t('architecture.show_in_action_layer', {
                  view: t(`view.${target.view}.name`),
                  n: target.layer,
                })}
            <span aria-hidden="true">→</span>
          </button>
        {/if}
      {:else}
        <p class="hint muted">{t('architecture.panel.hint')}</p>
      {/if}
    </aside>
  </div>

  <p class="visually-hidden" role="status">{announcement}</p>

  <ShowDetails>
    <!-- A scrolling region must be focusable, so keyboard users can scroll it (WCAG 2.1.1). -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="scroll-x table-wrap"
      role="region"
      aria-label={t('architecture.table')}
      tabindex="0"
    >
      <table data-param-table>
        <caption>{t('architecture.table_caption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('architecture.col.name')}</th>
            <th scope="col">{t('architecture.col.layer')}</th>
            <th scope="col">{t('architecture.col.shape')}</th>
            <th scope="col" class="num">{t('architecture.col.count')}</th>
            <th scope="col" class="num">{t('architecture.col.share')}</th>
          </tr>
        </thead>
        <tbody>
          {#each groups as g (g.name)}
            <tr data-param-row={g.name}>
              <th scope="row"><code>{g.name}</code></th>
              <td class="num">{g.layer ?? '–'}</td>
              <td class="num">{shapeText(g.shape)}</td>
              <td class="num">{fmt(g.count)}</td>
              <td class:num={!g.tiedTo}>
                {g.tiedTo
                  ? t('architecture.panel.share_tied', { name: g.tiedTo })
                  : formatPercent(g.share, 3)}
              </td>
            </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colspan="3">{t('architecture.total_row')}</th>
            <td class="num">{fmt(total)}</td>
            <td class="num">{formatPercent(1, 3)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </ShowDetails>
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

  .summary {
    display: grid;
    gap: var(--space-1);
    max-width: 40rem;
    margin-bottom: var(--space-5);
    padding: var(--space-4);
  }

  .summary p {
    margin: 0;
  }

  .total {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-3);
  }

  .total-label {
    font-weight: 600;
  }

  .total-value {
    font-family: var(--font-mono);
    font-size: var(--text-2xl);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .per-block,
  .note {
    font-size: var(--text-sm);
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
    padding-block: var(--space-1);
    border-bottom: 1px solid var(--color-border);
  }

  .exact dt {
    color: var(--color-text);
  }

  .exact dd {
    font-family: var(--font-mono);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .formula-link {
    font-weight: 600;
    color: var(--color-accent);
    text-underline-offset: 0.15em;
  }

  .help {
    max-width: 65ch;
  }

  .layout {
    display: grid;
    gap: var(--space-5);
    margin-top: var(--space-4);
  }

  @media (min-width: 52rem) {
    .layout {
      grid-template-columns: minmax(0, 30rem) minmax(16rem, 1fr);
      align-items: start;
    }

    .param-panel {
      position: sticky;
      top: var(--space-4);
    }
  }

  .diagram-wrap {
    margin: 0;
    padding: var(--space-3);
  }

  svg {
    display: block;
    width: 100%;
    height: auto;
    font-family: var(--font-sans);
    /* Decorative type colors: the panel is dark in both themes. */
    --type-embedding: #7dd3fc;
    --type-norm: #c4b5fd;
    --type-attention: #f9a8d4;
    --type-mlp: #86efac;
    --type-head: #fcd34d;
  }

  .frame {
    fill: none;
    stroke: var(--color-panel-border);
  }

  .block-frame {
    stroke-width: 1.5;
    stroke-dasharray: 6 4;
  }

  .group-frame {
    fill: rgb(255 255 255 / 0.025);
  }

  .frame-title {
    font-size: 13px;
    font-weight: 700;
    fill: var(--color-panel-text);
  }

  .group-title {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    fill: var(--color-panel-muted);
  }

  .repeat rect {
    fill: var(--color-panel-raised);
    stroke: var(--color-panel-muted);
  }

  .repeat text {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 700;
    fill: var(--color-panel-text);
  }

  .activation {
    font-size: 10.5px;
    fill: var(--color-panel-muted);
  }

  .spine {
    stroke: var(--color-panel-muted);
    stroke-width: 2;
  }

  .flow {
    fill: none;
    stroke: var(--color-panel-muted);
    stroke-width: 1.25;
  }

  .arrowhead {
    fill: var(--color-panel-muted);
  }

  .add circle {
    fill: var(--color-panel);
    stroke: var(--color-panel-muted);
    stroke-width: 1.5;
  }

  .add text {
    font-size: 14px;
    font-weight: 700;
    fill: var(--color-panel-text);
  }

  .io {
    fill: none;
    stroke: var(--color-panel-border);
    stroke-dasharray: 4 3;
  }

  .io-text {
    font-size: 11.5px;
    fill: var(--color-panel-muted);
  }

  .tied {
    fill: none;
    stroke: var(--type-head);
    stroke-width: 1.25;
    stroke-dasharray: 3 3;
  }

  .box {
    fill: var(--color-panel-raised);
    stroke: var(--color-panel-border);
  }

  .stripe {
    fill: var(--stripe);
  }

  .part[data-type='embedding'] {
    --stripe: var(--type-embedding);
  }
  .part[data-type='norm'] {
    --stripe: var(--type-norm);
  }
  .part[data-type='attention'] {
    --stripe: var(--type-attention);
  }
  .part[data-type='mlp'] {
    --stripe: var(--type-mlp);
  }
  .part[data-type='head'] {
    --stripe: var(--type-head);
  }

  .code {
    font-family: var(--font-mono);
    font-size: 12.5px;
    font-weight: 700;
    fill: var(--color-panel-text);
  }

  .subtitle {
    font-size: 10.5px;
    fill: var(--color-panel-muted);
  }

  .tied-text {
    fill: var(--type-head);
  }

  .chip {
    cursor: pointer;
    outline: none;
  }

  .chip-ring {
    fill: none;
    stroke: transparent;
    stroke-width: 3;
  }

  .chip:focus-visible .chip-ring {
    stroke: var(--color-focus);
  }

  .chip-body {
    fill: transparent;
    stroke: var(--color-panel-muted);
    stroke-width: 1.25;
    transition: fill var(--duration-fast) ease;
  }

  .chip:hover .chip-body {
    fill: var(--color-panel-border);
  }

  .chip-text {
    font-size: 11px;
    font-weight: 600;
    fill: var(--color-panel-text);
    pointer-events: none;
  }

  .chip.selected .chip-body {
    fill: var(--color-panel-text);
    stroke: var(--color-panel-text);
  }

  .chip.selected .chip-text {
    fill: var(--color-panel);
  }

  @media (prefers-reduced-motion: reduce) {
    .chip-body {
      transition: none;
    }
  }

  .param-panel {
    padding: var(--space-4);
    min-width: 0;
  }

  .param-name {
    margin: 0 0 var(--space-1);
    font-size: var(--text-lg);
    overflow-wrap: anywhere;
  }

  .part-line {
    margin: 0 0 var(--space-3);
  }

  .part-title {
    font-weight: 600;
  }

  .facts {
    display: grid;
    gap: var(--space-2);
    margin: 0 0 var(--space-3);
  }

  .facts div {
    display: grid;
    gap: 0.1rem;
  }

  dt {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  dd {
    margin: 0;
  }

  .facts .num {
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .layout-note {
    display: block;
    font-size: var(--text-sm);
  }

  .description,
  .tied-note {
    max-width: 60ch;
  }

  .tied-note {
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-raised);
    border-inline-start: 3px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
  }

  .hint {
    margin: 0;
  }

  .in-action {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 2.75rem;
    padding: var(--space-2) var(--space-4);
    font-weight: 700;
    color: var(--color-accent-contrast);
    background: var(--color-accent);
    border: 0;
    border-radius: var(--radius-pill);
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
  }

  td.num,
  th.num {
    text-align: end;
    font-variant-numeric: tabular-nums;
  }

  tfoot th,
  tfoot td {
    font-weight: 700;
    border-top: 2px solid var(--color-border-strong);
  }
</style>
