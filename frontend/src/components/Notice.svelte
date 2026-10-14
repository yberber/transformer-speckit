<!--
  A short message in the App's notice region, which is a polite live region: this component adds
  none of its own, since live regions must not be nested. The text appears just after the notice
  is created, so it is announced even when it was raised before the page was shown (a broken
  link, US7-3). With `ondismiss` it has a close button and stays until it is used.
-->
<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { t } from '../lib/i18n/index';

  let {
    message,
    ondismiss,
    ...rest
  }: { message: string; ondismiss?: () => void } & HTMLAttributes<HTMLDivElement> = $props();

  let ready = $state(false);
  $effect(() => {
    const timer = setTimeout(() => (ready = true), 100);
    return () => clearTimeout(timer);
  });
</script>

{#if ready}
  <div class="notice" {...rest}>
    <p>{message}</p>
    {#if ondismiss}
      <button
        type="button"
        class="dismiss"
        onclick={ondismiss}
        aria-label={t('notice.dismiss')}
        data-action="dismiss-notice"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <path
            d="M4 4l8 8M12 4l-8 8"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
          />
        </svg>
      </button>
    {/if}
  </div>
{/if}

<style>
  .notice {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    max-width: 40rem;
    padding: var(--space-3) var(--space-4);
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-panel);
    pointer-events: auto;
  }

  p {
    margin: 0;
    padding-block: var(--space-1);
  }

  .dismiss {
    display: inline-grid;
    flex: none;
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    margin: calc(-1 * var(--space-1)) calc(-1 * var(--space-2)) 0 0;
    color: var(--color-text-muted);
    background: transparent;
    border: 0;
    border-radius: var(--radius-pill);
  }

  .dismiss:hover {
    color: var(--color-text);
    background: var(--color-accent-soft);
  }
</style>
