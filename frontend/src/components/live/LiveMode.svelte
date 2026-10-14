<!--
  Live mode input (FR-008, FR-011, FR-013, US6-1..6), loaded as its own chunk only when the
  visitor switches to live mode. A labelled text field with what GPT-2 does, the privacy note
  and the limits; a code-point counter; tips for chat-style and non-English text; the waking,
  running and error states with Cancel and "Back to examples". The result itself is shown by the
  same views and controls as example mode: it is handed to the app through `onrun`.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { API_BASE_URL } from '../../lib/api/client';
  import type { RunData } from '../../lib/data/runData';
  import { t, type MessageKey } from '../../lib/i18n/index';
  import { limits } from '../../lib/limits';
  import { charCount, liveSession } from '../../lib/state/liveSession.svelte';

  let {
    onrun,
    onbacktoexamples,
    startText = null,
  }: {
    /** Called with each new live run, and with null when there is none. */
    onrun: (run: RunData | null) => void;
    onbacktoexamples: () => void;
    /** Run this text right away ("Continue in live mode") instead of only checking the service. */
    startText?: string | null;
  } = $props();

  const inputId = $props.id();
  const hintId = `${inputId}-hint`;
  const countId = `${inputId}-count`;

  const session = liveSession;
  const text = $derived(session.text);
  const count = $derived(charCount(text));
  const tooLong = $derived(count > limits.max_input_chars);
  const blank = $derived(text.trim() === '');
  const running = $derived(session.pending === 'run');
  const canRun = $derived(!blank && !tooLong && !running && !session.disabled);

  const CHAT_START = /^(what|who|why|how|when|where|can you|could you|please|tell me|write)\b/i;
  const chatLike = $derived(text.trim().endsWith('?') || CHAT_START.test(text.trim()));
  /** A letter outside ASCII: such text splits into many small tokens. */
  const nonEnglish = $derived(
    session.state === 'ready' && [...text].some((ch) => ch > '\x7f' && /\p{L}/u.test(ch)),
  );

  // Elapsed seconds while the service wakes up, updated once a second.
  let now = $state(Date.now());
  $effect(() => {
    if (session.wakingSince === null) return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });
  const elapsed = $derived(
    session.wakingSince === null ? 0 : Math.max(0, Math.floor((now - session.wakingSince) / 1000)),
  );

  const errorKey = (code: string) => `error.${code}` as MessageKey;
  /** A service on another model version keeps live mode off, with its message, until reload. */
  const shownError = $derived(
    session.disabled
      ? { code: 'version_mismatch' as const, params: {} }
      : session.state === 'error'
        ? session.error
        : null,
  );
  const statusKey = $derived(
    session.state === 'idle' || session.state === 'error'
      ? null
      : (`live.status.${session.state}` as MessageKey),
  );
  const cancellable = $derived(
    session.state === 'validating' || session.state === 'waking' || session.state === 'running',
  );

  $effect(() => onrun(session.state === 'ready' ? session.run : null));

  onMount(() => {
    if (startText !== null) void session.runText(startText);
    else void session.enter();
  });

  // Leaving live mode discards the text and the run.
  onDestroy(() => session.reset());

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (canRun) void session.runText(text);
  }
</script>

<section class="live" aria-labelledby="{inputId}-title" data-live-mode>
  <h2 class="title" id="{inputId}-title">{t('live.title')}</h2>

  <form onsubmit={submit} novalidate>
    <label class="label" for={inputId}>{t('live.input_label')}</label>
    <p class="hint" id={hintId} data-live-hint>{t('live.hint')}</p>
    <textarea
      id={inputId}
      rows="4"
      value={text}
      oninput={(e) => session.setText(e.currentTarget.value)}
      aria-describedby="{hintId} {countId}"
      aria-invalid={tooLong}
      disabled={session.disabled}
      spellcheck="false"
      autocomplete="off"
      data-live-input></textarea>

    <div class="meta">
      <p class="count" class:over={tooLong} id={countId} data-char-count>
        {t('live.char_count', { count, limit: limits.max_input_chars })}
      </p>
      <p class="limits" data-live-limits>
        {t('live.limits', { tokens: limits.max_input_tokens, steps: limits.max_new_tokens })}
      </p>
    </div>

    {#if chatLike && !blank}
      <p class="note tip" data-chat-tip>{t('live.chat_tip')}</p>
    {/if}

    <div class="actions">
      <button type="submit" class="run" disabled={!canRun} data-action="run">
        {t('live.run')}
      </button>
      <p class="privacy muted" data-live-privacy>{t('live.privacy')}</p>
    </div>
  </form>

  <div class="status" role="status" data-live-status data-state={session.state}>
    {#if statusKey}
      <p class="status-line">
        <span class="spinner" aria-hidden="true"></span>
        <span>{t(statusKey)}</span>
        {#if session.state === 'waking'}
          <span class="elapsed" aria-hidden="true" data-waking-elapsed
            >{t('live.status.elapsed', { seconds: elapsed })}</span
          >
        {/if}
      </p>
    {/if}
    {#if cancellable}
      <button type="button" class="secondary" onclick={() => session.cancel()} data-action="cancel">
        {t('live.cancel')}
      </button>
    {/if}
  </div>

  {#if nonEnglish}
    <p class="note" data-non-english-note>{t('live.non_english')}</p>
  {/if}

  {#if shownError}
    <div class="error" role="alert" data-live-error data-code={shownError.code}>
      <p>{t(errorKey(shownError.code), shownError.params)}</p>
      {#if shownError.code === 'wake_timeout'}
        <p>
          <a href={API_BASE_URL} target="_blank" rel="noopener noreferrer" data-space-link>
            {t('live.space_link')}
          </a>
        </p>
      {/if}
      <button
        type="button"
        class="secondary"
        onclick={onbacktoexamples}
        data-action="back-to-examples"
      >
        {t('live.back_to_examples')}
      </button>
    </div>
  {/if}
</section>

<style>
  .live {
    display: grid;
    gap: var(--space-3);
    margin: 0 0 var(--space-4);
    padding: var(--space-4);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-panel);
  }

  .title {
    margin: 0;
    font-size: var(--text-lg);
  }

  form {
    display: grid;
    gap: var(--space-2);
  }

  .label {
    font-weight: 700;
  }

  .hint,
  .meta p,
  .privacy {
    margin: 0;
    font-size: var(--text-sm);
  }

  .hint {
    max-width: 65ch;
    color: var(--color-text-muted);
  }

  textarea {
    width: 100%;
    min-height: 6rem;
    padding: var(--space-2) var(--space-3);
    font: inherit;
    line-height: var(--leading);
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    resize: vertical;
  }

  textarea[aria-invalid='true'] {
    border-color: var(--color-danger);
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-1) var(--space-4);
    color: var(--color-text-muted);
  }

  .count {
    font-variant-numeric: tabular-nums;
  }

  .count.over {
    font-weight: 700;
    color: var(--color-danger);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }

  .privacy {
    flex: 1 1 18rem;
  }

  button {
    min-height: 2.75rem;
    padding: var(--space-2) var(--space-5);
    font-weight: 700;
    border-radius: var(--radius-pill);
  }

  .run {
    color: var(--color-accent-contrast);
    background: var(--color-accent);
    border: 1px solid var(--color-accent);
  }

  .run:disabled {
    color: var(--color-text-muted);
    background: var(--color-surface-raised);
    border: 1px dashed var(--color-border-strong);
    cursor: not-allowed;
  }

  .secondary {
    color: var(--color-accent);
    background: var(--color-surface);
    border: 1px solid var(--color-border-strong);
  }

  .status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }

  .status-line {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
  }

  .elapsed {
    font-variant-numeric: tabular-nums;
    color: var(--color-text-muted);
  }

  .spinner {
    width: 1rem;
    height: 1rem;
    border: 2px solid var(--color-border-strong);
    border-top-color: var(--color-accent);
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }

  [data-state='ready'] .spinner {
    display: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
    }
  }

  @keyframes spin {
    to {
      transform: rotate(1turn);
    }
  }

  .note {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-inline-start: 4px solid var(--color-accent);
    border-radius: var(--radius-md);
  }

  .error {
    display: grid;
    justify-items: start;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    background: var(--color-danger-surface);
    border: 1px solid var(--color-danger);
    border-radius: var(--radius-md);
  }

  .error p {
    margin: 0;
  }

  .error a {
    color: var(--color-text);
  }
</style>
