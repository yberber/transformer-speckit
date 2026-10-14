<!--
  Language choice (FR-029). Each option is written in its own language (English, Türkçe,
  Deutsch) and marked with its `lang`, so a visitor finds theirs whatever the UI shows now. The
  choice is remembered; nothing else the visitor is looking at changes. A native radio group, like
  the theme switch, so it works with the keyboard and screen readers without extra code.
-->
<script lang="ts">
  import { LOCALES, t, type Locale } from '../lib/i18n/index';
  import { LANG_STORAGE_KEY } from '../lib/i18n/resolveLocale';
  import { viewState } from '../lib/state/viewState.svelte';

  const name = $props.id();

  /** Only the language changes; <html lang> follows once the catalog is in (setLocale). */
  function choose(locale: Locale): void {
    viewState.setLang(locale);
    try {
      globalThis.localStorage?.setItem(LANG_STORAGE_KEY, locale);
    } catch {
      // Storage can be unavailable (private mode, blocked site data); the switch still works.
    }
  }
</script>

<fieldset class="language-switch" data-language-switch>
  <legend>{t('header.language')}</legend>
  <div class="options">
    {#each LOCALES as locale (locale)}
      <label class:checked={viewState.lang === locale} lang={locale} data-lang-option={locale}>
        <input
          type="radio"
          {name}
          value={locale}
          checked={viewState.lang === locale}
          onchange={() => choose(locale)}
        />
        <span>{t(`lang.${locale}`)}</span>
      </label>
    {/each}
  </div>
</fieldset>

<style>
  .language-switch {
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
