<!--
  One token, colored by its position (FR-035). Color is never the only cue: the chip always shows
  the token's text, and its accessible name says the position ("token 3: space, “cat”"). Generated
  tokens also get a non-color marker (a dashed underline) and "generated" in the name.
-->
<script lang="ts">
  import type { Token } from '../lib/data/runData';
  import { t } from '../lib/i18n/index';
  import { tokenLabel } from '../lib/tokens/describe';
  import { NEWLINE_MARKER, SPACE_MARKER, tokenDisplay } from '../lib/tokens/display';
  import { tokenColor, tokenTextColor, type Theme } from '../lib/tokens/palette';

  let {
    token,
    position,
    theme,
    highlighted = false,
    origin,
  }: {
    token: Token;
    /** 0-based position in the run; shown 1-based. */
    position: number;
    theme: Theme;
    highlighted?: boolean;
    origin: 'input' | 'generated';
  } = $props();

  const display = $derived(tokenDisplay(token.bytes, token.id));

  /** Visible text split into plain runs and ␣/⏎ markers, so markers can be styled subtly. */
  const segments = $derived(
    display.kind === 'text'
      ? display.text
          .split(new RegExp(`([${SPACE_MARKER}${NEWLINE_MARKER}]+)`))
          .filter((s) => s !== '')
          .map((s) => ({ text: s, marker: s[0] === SPACE_MARKER || s[0] === NEWLINE_MARKER }))
      : [],
  );

  /** Everything shown, in order, as one list so no template whitespace renders between parts. */
  const visual = $derived.by(() => {
    if (display.kind === 'eos') return [{ text: `⟨${t('token.eos')}⟩`, cls: 'label' }];
    if (display.kind === 'partial') return [{ text: display.text, cls: 'bytes' }];
    const lead = display.leadingSpace ? [{ text: SPACE_MARKER, cls: 'marker' }] : [];
    return [
      ...lead,
      ...segments.map((seg) => ({ text: seg.text, cls: seg.marker ? 'marker' : '' })),
    ];
  });

  const spoken = $derived(tokenLabel(token, position, origin));
</script>

<span
  class="chip"
  class:generated={origin === 'generated'}
  class:highlighted
  class:special={display.kind !== 'text'}
  style:background-color={tokenColor(position, theme)}
  style:color={tokenTextColor(position, theme)}
  data-position={position}
  data-token-id={token.id}
>
  <span class="visual" aria-hidden="true"
    >{#each visual as v, i (i)}<span class={v.cls}>{v.text}</span>{/each}</span
  >
  <span class="visually-hidden">{spoken}</span>
</span>

<style>
  .chip {
    display: inline-flex;
    align-items: baseline;
    max-width: 100%;
    padding: 0.1em 0.4em;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.95em;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  .visual {
    white-space: pre-wrap;
  }

  .marker {
    font-size: 0.8em;
    font-weight: 300;
  }

  .bytes,
  .label {
    font-size: 0.85em;
    font-style: italic;
  }

  .generated {
    border-bottom: 2px dashed currentColor;
  }

  .highlighted {
    outline: 2px solid var(--color-text);
    outline-offset: 2px;
    box-shadow: 0 0 0 4px var(--color-bg);
  }
</style>
