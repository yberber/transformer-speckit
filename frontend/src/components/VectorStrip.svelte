<!--
  One embedding vector as a color strip (FR-015): one cell per dimension for all values, never a
  sample. Blue is negative, orange positive, the panel color zero. The scale is symmetric around
  zero up to `scale` (the largest |value| of the token's three vectors), so the strips of one token
  are comparable; a square-root curve keeps small values visible next to GPT-2's few very large
  dimensions. Every value gets at least one device pixel: when the strip is narrower than the
  vector, it wraps onto more lines instead of dropping values or scrolling sideways.
-->
<script lang="ts">
  import { t } from '../lib/i18n/index';
  import { formatNumber } from '../lib/i18n/format';
  import type { Theme } from '../lib/tokens/palette';

  let {
    values,
    scale,
    label,
    theme,
    kind,
  }: {
    values: Float32Array;
    /** Largest |value| the colors span; values beyond it get the end colors. */
    scale: number;
    /** Visible label, also the start of the accessible name. */
    label: string;
    theme: Theme;
    /** Which vector this is (data-strip hook for tests). */
    kind: 'token' | 'position' | 'sum';
  } = $props();

  /** Zero, negative end and positive end of the diverging scale, as RGB, per theme. */
  const COLORS: Record<Theme, { mid: number[]; neg: number[]; pos: number[] }> = {
    light: { mid: [42, 52, 84], neg: [96, 165, 255], pos: [255, 146, 64] },
    dark: { mid: [30, 40, 66], neg: [86, 156, 255], pos: [255, 140, 56] },
  };
  const LINE_HEIGHT = 14;

  let canvas: HTMLCanvasElement | undefined = $state();
  let width = $state(0);

  const summary = $derived.by(() => {
    let min = Infinity;
    let max = -Infinity;
    let total = 0;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
      total += v;
    }
    const fmt = (v: number) => formatNumber(v, { maximumSignificantDigits: 3 });
    return t('strip.summary', {
      label,
      count: values.length,
      min: fmt(min),
      max: fmt(max),
      mean: fmt(total / values.length),
    });
  });

  /** Lines needed so each value gets ≥ 1 device pixel; recomputed on resize and zoom. */
  const layout = $derived.by(() => {
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const devicePx = Math.max(1, Math.floor(width * dpr));
    const lines = Math.max(1, Math.ceil(values.length / devicePx));
    return { dpr, devicePx, lines, perLine: Math.ceil(values.length / lines) };
  });

  function color(v: number): string {
    const { mid, neg, pos } = COLORS[theme];
    const f = scale > 0 ? Math.min(1, Math.sqrt(Math.abs(v) / scale)) : 0;
    const end = v < 0 ? neg : pos;
    const c = mid.map((m, i) => Math.round(m + (end[i]! - m) * f));
    return `rgb(${c[0]} ${c[1]} ${c[2]})`;
  }

  $effect(() => {
    if (!canvas || width === 0) return;
    const { dpr, devicePx, lines, perLine } = layout;
    const lineHeight = Math.round(LINE_HEIGHT * dpr);
    canvas.width = devicePx;
    canvas.height = lines * lineHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    for (let i = 0; i < values.length; i++) {
      const col = i % perLine;
      const line = Math.floor(i / perLine);
      const x0 = Math.floor((col * devicePx) / perLine);
      const x1 = Math.floor(((col + 1) * devicePx) / perLine);
      ctx.fillStyle = color(values[i]!);
      ctx.fillRect(x0, line * lineHeight, Math.max(1, x1 - x0), lineHeight);
    }
  });
</script>

<div class="vector-strip">
  <span class="label" aria-hidden="true">{label}</span>
  <div class="track" bind:clientWidth={width}>
    <!-- ARIA in HTML allows any role on <canvas>; role="img" + a label is the text equivalent. -->
    <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
    <canvas
      bind:this={canvas}
      role="img"
      aria-label={summary}
      data-strip={kind}
      style:height="{layout.lines * LINE_HEIGHT}px"
    ></canvas>
  </div>
</div>

<style>
  .vector-strip {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .label {
    font-size: var(--text-xs);
    color: var(--color-panel-muted);
  }

  .track {
    min-width: 0;
    line-height: 0;
  }

  canvas {
    display: block;
    width: 100%;
    border-radius: 2px;
    outline: 1px solid var(--color-panel-border);
  }
</style>
