<!--
  Example mode or live mode (FR-008). Shown only in builds that name an inference API; example
  mode is always the default and always works without it (Principle V). A native radio group,
  like the language and theme switches.
-->
<script lang="ts">
  import { t } from '../lib/i18n/index';
  import type { Mode } from '../lib/state/viewState.svelte';

  let { mode, onselect }: { mode: Mode; onselect: (mode: Mode) => void } = $props();

  const MODES: readonly Mode[] = ['example', 'live'];
  const name = $props.id();
</script>

<fieldset class="mode-switch" data-mode-switch>
  <legend>{t('mode.label')}</legend>
  <div class="options">
    {#each MODES as m (m)}
      <label class:checked={mode === m} data-mode-option={m}>
        <input type="radio" {name} value={m} checked={mode === m} onchange={() => onselect(m)} />
        <span>{t(`mode.${m}`)}</span>
      </label>
    {/each}
  </div>
</fieldset>

<style>
  .mode-switch {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    float: left;
    margin-inline-end: var(--space-2);
    padding: 0;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .options {
    display: inline-flex;
    padding: 2px;
    background: var(--color-surface);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-pill);
  }

  label {
    position: relative;
    display: inline-flex;
    align-items: center;
    min-height: 2.25rem;
    padding: 0 var(--space-3);
    font-size: var(--text-sm);
    border-radius: var(--radius-pill);
    cursor: pointer;
  }

  label.checked {
    font-weight: 700;
    color: var(--color-accent-contrast);
    background: var(--color-accent);
  }

  /* The radio stays in the accessibility tree; its focus ring is drawn on the label. */
  input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  label:has(input:focus-visible) {
    outline: var(--focus-width) solid var(--color-focus);
    outline-offset: 2px;
  }
</style>
