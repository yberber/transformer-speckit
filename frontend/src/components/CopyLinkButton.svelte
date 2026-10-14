<!--
  "Copy link" (US7-1, US7-4). In example mode it copies the address, which always holds the
  current state, already normalized (contracts/url-state.md). If the browser refuses the
  clipboard, the link appears selected in a read-only field to copy by hand. In live mode nothing
  is copied: links never include the visitor's own text (FR-034), and the button says so. Each
  result is announced politely.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../lib/i18n/index';
  import type { Mode } from '../lib/state/viewState.svelte';

  let { mode }: { mode: Mode } = $props();

  const MESSAGES = {
    copied: 'share.copied',
    manual: 'share.copy_manual',
    live: 'share.live_not_included',
  } as const;
  type Status = keyof typeof MESSAGES;

  let status = $state<Status | null>(null);
  /** The link to copy by hand, after the clipboard refused it. */
  let manualUrl = $state<string | null>(null);
  let field: HTMLInputElement | undefined = $state();
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  async function show(next: Status): Promise<void> {
    // Cleared first, so pressing again announces the message again.
    clearTimeout(hideTimer);
    status = null;
    await tick();
    status = next;
    if (next === 'copied') hideTimer = setTimeout(() => (status = null), 5000);
  }

  async function copy(): Promise<void> {
    manualUrl = null;
    if (mode === 'live') return show('live');
    const href = location.href;
    try {
      await navigator.clipboard.writeText(href);
      await show('copied');
    } catch {
      // No clipboard (insecure context, old browser) or permission denied.
      manualUrl = href;
      await show('manual');
      field?.focus();
      field?.select();
    }
  }
</script>

<div class="copy-link" data-copy-link>
  <button type="button" class="button" onclick={copy} data-action="copy-link">
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        d="M6.5 9.5l3-3M7 4.5l1-1a2.83 2.83 0 0 1 4 4l-1 1M9 11.5l-1 1a2.83 2.83 0 0 1-4-4l1-1"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
    {t('share.copy_link')}
  </button>
  {#if manualUrl}
    <input
      class="url"
      type="text"
      readonly
      value={manualUrl}
      aria-label={t('share.link_label')}
      bind:this={field}
      onfocus={(e) => e.currentTarget.select()}
      data-share-url
    />
  {/if}
  <p class="status" role="status" aria-live="polite" data-copy-status>
    {#if status}{t(MESSAGES[status])}{/if}
  </p>
</div>

<style>
  .copy-link {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
  }

  .button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 2.5rem;
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-accent);
    background: transparent;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-pill);
  }

  .button:hover {
    background: var(--color-accent-soft);
  }

  .url {
    flex: 1 1 16rem;
    min-width: 0;
    min-height: 2.5rem;
    padding: var(--space-1) var(--space-3);
    font: inherit;
    font-size: var(--text-sm);
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
  }

  /* Always rendered (a live region must exist before it speaks); empty, it takes no room. */
  .status {
    flex: 1 1 auto;
    min-width: 0;
    max-width: 65ch;
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }
</style>
