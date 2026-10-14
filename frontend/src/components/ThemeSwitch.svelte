<!--
  Theme choice (FR-037): follow the system, or force light or dark. A native radio group, so it
  works with the keyboard (arrow keys) and screen readers without extra code.
-->
<script lang="ts">
  import { t } from '../lib/i18n/index';
  import { THEMES, viewState } from '../lib/state/viewState.svelte';

  const name = $props.id();
</script>

<fieldset class="theme-switch">
  <legend>{t('theme.label')}</legend>
  <div class="options">
    {#each THEMES as theme (theme)}
      <label class:checked={viewState.theme === theme}>
        <input
          type="radio"
          {name}
          value={theme}
          checked={viewState.theme === theme}
          onchange={() => viewState.setTheme(theme)}
        />
        <span>{t(`theme.${theme}`)}</span>
      </label>
    {/each}
  </div>
</fieldset>

<style>
  .theme-switch {
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
