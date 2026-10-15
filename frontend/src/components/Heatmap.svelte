<!--
  Attention heatmap of one head (FR-017, FR-038, US2-4/5). Rows are the tokens that look (query),
  columns the tokens they look at (key), for the current prefix. Future cells (column after row)
  are masked: drawn hatched and lighter, so the mask never depends on color alone.

  Keyboard: the grid is one focusable element with a roving active cell. Arrow keys, Home/End and
  Page Up/Down move within the valid cells only; the polite readout names both tokens and the
  weight, and both tokens are highlighted through `onhighlight`. "Show as table" gives the same
  numbers as a table. When cells would be narrower than 10 CSS px (phones, long texts), the view
  switches to a focused mode: pick one token and see its weights as a ranked list and a strip.
  The ranked rows are one tab stop (arrow keys move between them); focusing or hovering a row
  highlights its pair and shows its weight in the readout, with the exact value on demand.

  `select` lets the page choose a pair from outside (a focused or hovered token): it becomes the
  active cell, or the focused-mode token and its ranked row.
-->
<script lang="ts">
  import { packedIndex } from '../lib/data/binary';
  import type { Token } from '../lib/data/runData';
  import { t } from '../lib/i18n/index';
  import { formatNumber } from '../lib/i18n/format';
  import { spokenText } from '../lib/tokens/describe';
  import { SPACE_MARKER, tokenDisplay } from '../lib/tokens/display';
  import type { Theme } from '../lib/tokens/palette';
  import ShowDetails from './ShowDetails.svelte';
  import TokenChip from './TokenChip.svelte';

  let {
    weights,
    tokens,
    nInput,
    theme,
    label,
    select = null,
    onhighlight,
  }: {
    /** One head's packed causal triangle for exactly `tokens.length` tokens. */
    weights: Float32Array;
    /** The visible tokens (prefix of the run). */
    tokens: Token[];
    nInput: number;
    theme: Theme;
    /** Accessible name of the grid, e.g. "Attention of layer 5, head 3". */
    label: string;
    /** [query, key] pair chosen outside the heatmap, or null. */
    select?: [number, number] | null;
    /** Called with [query, key] positions of the active or hovered cell, or null. */
    onhighlight?: (pair: [number, number] | null) => void;
  } = $props();

  const MIN_CELL = 10;
  const MAX_CELL = 36;
  const PAGE = 10;
  /** Sequential scale for weights 0 → 1 (viridis stops), legible on the dark panel. */
  const RAMP = [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37],
  ];

  const size = $derived(tokens.length);
  const uid = $props.id();

  let width = $state(0);
  const labelWidth = $derived(width >= 480 ? 112 : 0);
  const cell = $derived(size > 0 ? Math.min(MAX_CELL, (width - labelWidth) / size) : 0);
  const mode = $derived<'grid' | 'focused' | null>(
    width === 0 ? null : cell < MIN_CELL ? 'focused' : 'grid',
  );

  // --- cells and text ---------------------------------------------------------------------

  const weight = (i: number, j: number) => weights[packedIndex(i, j)]!;
  const dec3 = (w: number) =>
    formatNumber(w, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const sig7 = (w: number) =>
    formatNumber(w, { minimumSignificantDigits: 7, maximumSignificantDigits: 7 });
  const origin = (i: number) => (i < nInput ? 'input' : 'generated');

  /** Short visible text of a token: ␣ for a leading space, labels for special tokens. */
  function shortText(i: number): string {
    const d = tokenDisplay(tokens[i]!.bytes, tokens[i]!.id);
    if (d.kind === 'eos') return `⟨${t('token.eos')}⟩`;
    return d.leadingSpace ? SPACE_MARKER + d.text : d.text;
  }

  function cellText(i: number, j: number): string {
    const spoken = (p: number) => spokenText(tokenDisplay(tokens[p]!.bytes, tokens[p]!.id));
    return t('heatmap.readout', {
      qpos: i + 1,
      query: spoken(i),
      kpos: j + 1,
      key: spoken(j),
      weight: dec3(weight(i, j)),
    });
  }

  // --- active cell and keyboard -----------------------------------------------------------

  let active = $state<[number, number]>([0, 0]);
  let hover = $state<[number, number] | null>(null);
  let focused = $state(false);

  /** Keep the active cell valid when the prefix shrinks (stepping back). */
  const current = $derived.by<[number, number]>(() => {
    const i = Math.min(active[0], size - 1);
    return [i, Math.min(active[1], i)];
  });

  function move(i: number, j: number): void {
    const row = Math.max(0, Math.min(size - 1, i));
    active = [row, Math.max(0, Math.min(row, j))];
    onhighlight?.(active);
  }

  function onkeydown(e: KeyboardEvent): void {
    const [i, j] = current;
    const keys: Record<string, () => void> = {
      ArrowRight: () => move(i, j + 1),
      ArrowLeft: () => move(i, j - 1),
      ArrowDown: () => move(i + 1, j),
      ArrowUp: () => move(i - 1, j),
      Home: () => (e.ctrlKey ? move(0, 0) : move(i, 0)),
      End: () => (e.ctrlKey ? move(size - 1, size - 1) : move(i, i)),
      PageDown: () => move(i + PAGE, j),
      PageUp: () => move(i - PAGE, j),
    };
    const action = keys[e.key];
    if (!action) return;
    e.preventDefault();
    action();
  }

  function cellAt(e: PointerEvent): [number, number] | null {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const i = Math.floor((e.clientY - rect.top) / cell);
    const j = Math.floor((e.clientX - rect.left) / cell);
    return i >= 0 && i < size && j >= 0 && j <= i ? [i, j] : null;
  }

  // --- drawing ----------------------------------------------------------------------------

  let canvas: HTMLCanvasElement | undefined = $state();

  function ramp(w: number): string {
    const x = Math.max(0, Math.min(1, w)) * (RAMP.length - 1);
    const k = Math.min(RAMP.length - 2, Math.floor(x));
    const f = x - k;
    const c = RAMP[k]!.map((a, n) => Math.round(a + (RAMP[k + 1]![n]! - a) * f));
    return `rgb(${c[0]} ${c[1]} ${c[2]})`;
  }

  $effect(() => {
    if (mode !== 'grid' || !canvas) return;
    const [ai, aj] = current;
    const dpr = window.devicePixelRatio || 1;
    const px = cell * dpr;
    const total = Math.round(size * px);
    canvas.width = total;
    canvas.height = total;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const styles = getComputedStyle(canvas);
    const focusColor = styles.getPropertyValue('--color-focus').trim() || '#fbbf24';
    const gap = px >= 8 ? 1 : 0;
    const edge = (n: number) => Math.round(n * px);

    ctx.clearRect(0, 0, total, total);
    // Valid cells.
    for (let i = 0; i < size; i++) {
      for (let j = 0; j <= i; j++) {
        ctx.fillStyle = ramp(weight(i, j));
        ctx.fillRect(edge(j), edge(i), edge(j + 1) - edge(j) - gap, edge(i + 1) - edge(i) - gap);
      }
    }
    // Masked cells: a lighter fill plus diagonal hatching, clipped to the upper triangle.
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < size - 1; i++) {
      ctx.rect(edge(i + 1), edge(i), total - edge(i + 1), edge(i + 1) - edge(i));
    }
    ctx.clip();
    ctx.fillStyle = theme === 'dark' ? 'rgb(255 255 255 / 0.05)' : 'rgb(255 255 255 / 0.08)';
    ctx.fillRect(0, 0, total, total);
    ctx.strokeStyle = 'rgb(255 255 255 / 0.22)';
    ctx.lineWidth = Math.max(1, dpr);
    const step = 6 * dpr;
    ctx.beginPath();
    for (let x = -total; x < total; x += step) {
      ctx.moveTo(x, total);
      ctx.lineTo(x + total, 0);
    }
    ctx.stroke();
    ctx.restore();
    // Active (keyboard) and hovered cells.
    const outline = (i: number, j: number, color: string, lw: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.strokeRect(
        edge(j) + lw / 2,
        edge(i) + lw / 2,
        edge(j + 1) - edge(j) - lw,
        edge(i + 1) - edge(i) - lw,
      );
    };
    if (hover) outline(hover[0], hover[1], '#ffffff', Math.max(1, dpr));
    if (focused || select) outline(ai, aj, focusColor, Math.max(2, 2 * dpr));
  });

  // --- table and focused mode -------------------------------------------------------------

  let tableOpen = $state(false);

  let focusToken = $state<number | null>(null);
  const focusRow = $derived(Math.min(focusToken ?? size - 1, size - 1));
  const ranked = $derived(
    Array.from({ length: focusRow + 1 }, (_, j) => ({ j, w: weight(focusRow, j) })).sort(
      (a, b) => b.w - a.w || a.j - b.j,
    ),
  );

  /** The ranked row that holds the tab stop (by key position); the top row by default. */
  let rankKey = $state<number | null>(null);
  const activeKey = $derived(rankKey !== null && rankKey <= focusRow ? rankKey : ranked[0]!.j);
  let rankHover = $state<number | null>(null);
  let rankFocused = $state(false);
  /** The pair the focused-mode readout describes: the hovered row, else the active one. */
  const shownKey = $derived(rankHover !== null && rankHover <= focusRow ? rankHover : activeKey);
  let rankedList: HTMLOListElement | undefined = $state();

  function onRankKey(e: KeyboardEvent): void {
    const at = ranked.findIndex((r) => r.j === activeKey);
    const to: Record<string, number> = {
      ArrowDown: at + 1,
      ArrowUp: at - 1,
      Home: 0,
      End: ranked.length - 1,
    };
    if (!(e.key in to)) return;
    e.preventDefault();
    const next = ranked[Math.max(0, Math.min(ranked.length - 1, to[e.key]!))]!;
    rankedList?.querySelector<HTMLElement>(`[data-key="${next.j}"]`)?.focus();
  }

  $effect(() => {
    if (!select) return;
    const [i, j] = select;
    active = [i, j];
    focusToken = i;
    rankKey = j;
  });

  let stripCanvas: HTMLCanvasElement | undefined = $state();
  let stripWidth = $state(0);

  $effect(() => {
    if (mode !== 'focused' || !stripCanvas || stripWidth === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const total = Math.round(stripWidth * dpr);
    const height = Math.round(18 * dpr);
    stripCanvas.width = total;
    stripCanvas.height = height;
    const ctx = stripCanvas.getContext('2d');
    if (!ctx) return;
    const n = focusRow + 1;
    for (let j = 0; j < n; j++) {
      ctx.fillStyle = ramp(weight(focusRow, j));
      const x0 = Math.floor((j * total) / n);
      ctx.fillRect(x0, 0, Math.max(1, Math.floor(((j + 1) * total) / n) - x0), height);
    }
  });
</script>

<div class="heatmap" data-heatmap data-mode={mode ?? 'pending'} bind:clientWidth={width}>
  {#if mode === 'grid'}
    <div class="grid-area">
      {#if labelWidth > 0}
        <ol class="row-labels" style:width="{labelWidth}px" aria-hidden="true">
          {#each tokens as _, i (i)}
            <li
              style:height="{cell}px"
              style:font-size="{Math.min(13, cell * 0.7)}px"
              class:on={current[0] === i || current[1] === i}
            >
              <span class="pos num">{i + 1}</span>
              <span class="text">{shortText(i)}</span>
            </li>
          {/each}
        </ol>
      {/if}
      <!-- One focusable widget with a roving active cell (R17); the readout below is its voice.
           role="application" makes screen readers pass the arrow keys to the widget. Svelte
           counts that role as non-interactive, hence the ignore. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div
        class="grid"
        role="application"
        tabindex="0"
        aria-roledescription={t('heatmap.roledescription')}
        aria-label={label}
        aria-describedby="{uid}-help {uid}-readout"
        data-heatmap-grid
        data-active={current.join(',')}
        data-size={size}
        style:width="{size * cell}px"
        style:height="{size * cell}px"
        {onkeydown}
        onfocus={() => {
          focused = true;
          onhighlight?.(current);
        }}
        onblur={() => {
          focused = false;
          onhighlight?.(null);
        }}
        onpointermove={(e) => {
          hover = cellAt(e);
          onhighlight?.(hover ?? (focused ? current : null));
        }}
        onpointerleave={() => {
          hover = null;
          onhighlight?.(focused ? current : null);
        }}
        onpointerdown={(e) => {
          const c = cellAt(e);
          if (c) move(c[0], c[1]);
        }}
      >
        <canvas bind:this={canvas} aria-hidden="true"></canvas>
      </div>
    </div>

    <p id="{uid}-help" class="help muted">{t('heatmap.help')}</p>
    <p id="{uid}-readout" class="readout" aria-live="polite" data-heatmap-readout>
      {cellText(current[0], current[1])}
    </p>
    <ShowDetails>
      <p class="exact" data-heatmap-exact>
        {t('heatmap.exact', { weight: sig7(weight(current[0], current[1])) })}
      </p>
    </ShowDetails>
  {:else if mode === 'focused'}
    <p class="muted focused-note">{t('heatmap.focused_note')}</p>
    <label class="focus-label" for="{uid}-token">{t('heatmap.focus_token')}</label>
    <select
      id="{uid}-token"
      data-focus-token
      value={focusRow}
      onchange={(e) => {
        focusToken = Number(e.currentTarget.value);
        rankKey = null;
        onhighlight?.([focusToken, activeKey]);
      }}
    >
      {#each tokens as _, i (i)}
        <option value={i}>{t('heatmap.token_option', { pos: i + 1, text: shortText(i) })}</option>
      {/each}
    </select>
    <div class="strip" bind:clientWidth={stripWidth}>
      <!-- ARIA in HTML allows any role on <canvas>; the ranked list below has the same data. -->
      <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
      <canvas
        bind:this={stripCanvas}
        role="img"
        aria-label={t('heatmap.strip', { pos: focusRow + 1 })}
        data-focus-strip
      ></canvas>
    </div>
    <p class="readout" aria-live="polite" data-heatmap-readout>
      {cellText(focusRow, shownKey)}
    </p>
    <ShowDetails>
      <p class="exact" data-heatmap-exact>
        {t('heatmap.exact', { weight: sig7(weight(focusRow, shownKey)) })}
      </p>
    </ShowDetails>
    <ol
      class="ranked"
      aria-label={t('heatmap.ranked', { pos: focusRow + 1 })}
      data-ranked-list
      bind:this={rankedList}
    >
      {#each ranked as r (r.j)}
        <li>
          <button
            type="button"
            class="rank"
            class:on={r.j === shownKey}
            tabindex={r.j === activeKey ? 0 : -1}
            data-key={r.j}
            data-active={r.j === activeKey}
            onfocus={() => {
              rankFocused = true;
              rankKey = r.j;
              rankHover = null;
              onhighlight?.([focusRow, r.j]);
            }}
            onblur={() => {
              rankFocused = false;
              onhighlight?.(null);
            }}
            onclick={() => (rankKey = r.j)}
            onmouseenter={() => {
              rankHover = r.j;
              onhighlight?.([focusRow, r.j]);
            }}
            onmouseleave={() => {
              rankHover = null;
              onhighlight?.(rankFocused ? [focusRow, activeKey] : null);
            }}
            onkeydown={onRankKey}
          >
            <span class="chip">
              <TokenChip token={tokens[r.j]!} position={r.j} {theme} origin={origin(r.j)} />
            </span>
            <span class="bar" aria-hidden="true">
              <span class="fill" style:width="{r.w * 100}%"></span>
            </span>
            <span class="num" data-weight>{dec3(r.w)}</span>
          </button>
        </li>
      {/each}
    </ol>
  {/if}

  {#if mode !== null}
    <p class="legend muted">
      <span class="ramp" aria-hidden="true"></span>
      {t('heatmap.legend.weight')}
      <span class="hatch" aria-hidden="true"></span>
      {t('heatmap.legend.masked')}
    </p>

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
        <div class="table-wrap" role="region" aria-label={label} tabindex="0">
          <table data-heatmap-table>
            <caption>{t('heatmap.table_caption')}</caption>
            <thead>
              <tr>
                <td class="corner"></td>
                {#each tokens as _, j (j)}
                  <th scope="col"><span class="num">{j + 1}</span> <code>{shortText(j)}</code></th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each tokens as _, i (i)}
                <tr>
                  <th scope="row"><span class="num">{i + 1}</span> <code>{shortText(i)}</code></th>
                  {#each tokens as __, j (j)}
                    {#if j <= i}
                      <td class="num" data-weight>{dec3(weight(i, j))}</td>
                    {:else}
                      <td class="masked">
                        <span aria-hidden="true">·</span>
                        <span class="visually-hidden">{t('heatmap.masked_cell')}</span>
                      </td>
                    {/if}
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .heatmap {
    min-width: 0;
  }

  .grid-area {
    display: flex;
    align-items: flex-start;
  }

  .row-labels {
    flex: none;
    margin: 0;
    padding: 0 var(--space-2) 0 0;
    list-style: none;
  }

  .row-labels li {
    display: flex;
    align-items: center;
    gap: 0.4em;
    overflow: hidden;
    font-family: var(--font-mono);
    line-height: 1;
    white-space: pre;
    color: var(--color-panel-muted);
  }

  .row-labels li.on {
    color: var(--color-panel-text);
    font-weight: 700;
  }

  .row-labels .pos {
    flex: none;
    min-width: 2ch;
    text-align: end;
  }

  .row-labels .text {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .grid {
    flex: none;
    line-height: 0;
    border-radius: 2px;
    touch-action: none;
  }

  .grid canvas {
    width: 100%;
    height: 100%;
  }

  .help {
    margin: var(--space-3) 0 var(--space-1);
    font-size: var(--text-xs);
  }

  .readout {
    min-height: 3em;
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  .exact {
    margin: 0;
    font-family: var(--font-mono);
  }

  .focused-note {
    max-width: 65ch;
    font-size: var(--text-sm);
  }

  .focus-label {
    display: block;
    margin-bottom: var(--space-1);
    font-weight: 600;
  }

  select,
  .table-toggle {
    min-height: 2.75rem;
    max-width: 100%;
    padding: var(--space-1) var(--space-3);
    font-weight: 600;
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
  }

  .strip {
    margin: var(--space-3) 0;
    line-height: 0;
  }

  .strip canvas {
    width: 100%;
    height: 18px;
    border-radius: 2px;
  }

  .ranked {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .rank {
    display: grid;
    grid-template-columns: minmax(4rem, 8rem) 1fr 3.5rem;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: 2px var(--space-1);
    font: inherit;
    color: inherit;
    text-align: start;
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
  }

  .rank:hover,
  .rank.on {
    background: var(--color-panel-raised);
  }

  .chip {
    display: flex;
    min-width: 0;
  }

  .bar {
    height: 0.6rem;
    overflow: hidden;
    background: var(--color-panel-raised);
    border-radius: var(--radius-pill);
  }

  .fill {
    display: block;
    min-width: 2px;
    height: 100%;
    background: rgb(253 231 37);
  }

  .ranked .num {
    text-align: end;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    margin: var(--space-3) 0;
    font-size: var(--text-xs);
  }

  .ramp,
  .hatch {
    display: inline-block;
    width: 3em;
    height: 0.8em;
    border-radius: 2px;
    outline: 1px solid var(--color-panel-border);
  }

  .ramp {
    background: linear-gradient(
      90deg,
      rgb(68 1 84),
      rgb(59 82 139),
      rgb(33 145 140),
      rgb(94 201 98),
      rgb(253 231 37)
    );
  }

  .hatch {
    margin-inline-start: var(--space-3);
    background: repeating-linear-gradient(
      -45deg,
      rgb(255 255 255 / 0.22) 0 1px,
      rgb(255 255 255 / 0.06) 1px 6px
    );
  }

  .table-wrap {
    max-height: 28rem;
    margin-top: var(--space-3);
    overflow: auto;
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  table {
    border-collapse: collapse;
    font-size: var(--text-xs);
  }

  caption {
    padding: var(--space-2) var(--space-3);
    text-align: start;
    color: var(--color-text-muted);
  }

  th,
  td {
    padding: 2px var(--space-2);
    text-align: end;
    white-space: pre;
    border: 1px solid var(--color-border);
  }

  thead th,
  .corner {
    position: sticky;
    top: 0;
    background: var(--color-surface-raised);
  }

  tbody th {
    position: sticky;
    left: 0;
    text-align: start;
    background: var(--color-surface-raised);
  }

  th .num {
    color: var(--color-text-muted);
  }

  .masked {
    color: var(--color-text-muted);
    text-align: center;
    background: repeating-linear-gradient(
      -45deg,
      var(--color-surface-raised) 0 3px,
      var(--color-surface) 3px 6px
    );
  }
</style>
