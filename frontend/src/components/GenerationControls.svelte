<!--
  Step through generation one token at a time (FR-007): Back, "Next token" and a "Step k of N"
  counter. Each press is announced politely, naming the token that was added. At the last step
  "Next token" is disabled and a message says why the text ends there; live mode can offer to
  continue through the `liveOffer` snippet (US6). While the run loads, the bar is shown at its
  final size with both buttons disabled, so the view below it does not move when data arrives.
-->
<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import type { RunData } from '../lib/data/runData';
  import { t } from '../lib/i18n/index';
  import { limits } from '../lib/limits';
  import { clearAppended, markAppended } from '../lib/state/appended';
  import { canAdvance, detectRepetition, endMessageKey } from '../lib/state/generation';
  import { viewState } from '../lib/state/viewState.svelte';
  import { tokenLabel } from '../lib/tokens/describe';

  let { run, liveOffer }: { run: RunData | null; liveOffer?: Snippet } = $props();

  const step = $derived(viewState.step);
  const atEnd = $derived(run !== null && !canAdvance(run, step));
  const repeating = $derived(run !== null && detectRepetition(run.tokens, run.nInput, step));

  let announcement = $state('');
  let backButton: HTMLButtonElement | undefined = $state();
  let nextButton: HTMLButtonElement | undefined = $state();

  /** A button that becomes disabled loses focus; hand it to the other button instead. */
  async function keepFocus(from: HTMLButtonElement | undefined, to: HTMLButtonElement | undefined) {
    const hadFocus = from !== undefined && document.activeElement === from;
    await tick();
    if (hadFocus && from?.disabled) to?.focus();
  }

  function next(): void {
    if (!run || !canAdvance(run, step)) return;
    const position = run.nInput + step;
    markAppended(position);
    viewState.setStep(step + 1);
    announcement = t('generation.added', {
      step: step + 1,
      token: tokenLabel(run.tokens[position]!, position, 'generated'),
    });
    void keepFocus(nextButton, backButton);
  }

  function back(): void {
    if (step === 0) return;
    clearAppended();
    viewState.setStep(step - 1);
    announcement = t('generation.removed', { step: step - 1 });
    void keepFocus(backButton, nextButton);
  }
</script>

<div
  class="generation"
  role="group"
  aria-label={t('generation.label')}
  aria-busy={run === null}
  data-generation-controls
>
  <div class="bar">
    <button
      type="button"
      class="back"
      data-action="back"
      disabled={!run || step === 0}
      onclick={back}
      bind:this={backButton}
    >
      <span aria-hidden="true">←</span>
      {t('generation.back')}
    </button>

    {#if run}
      <div class="counter" data-step-counter data-step={step}>
        <span class="step">{t('generation.step', { step, total: run.steps })}</span>
        <span class="generated">{t('generation.generated', { count: step })}</span>
        <span class="progress" aria-hidden="true">
          <span class="fill" style:width="{run.steps === 0 ? 100 : (step / run.steps) * 100}%"
          ></span>
        </span>
      </div>
    {:else}
      <div class="counter">
        <span class="step" role="status">{t('status.loading')}</span>
        <span class="generated">&nbsp;</span>
        <span class="progress" aria-hidden="true"></span>
      </div>
    {/if}

    <button
      type="button"
      class="next"
      data-action="next"
      disabled={!run || atEnd}
      onclick={next}
      bind:this={nextButton}
    >
      {t('generation.next')}
      <span aria-hidden="true">→</span>
    </button>
  </div>

  {#if run && atEnd}
    <div class="message end" data-end-message data-stop-reason={run.stopReason}>
      <p>{t(endMessageKey(run.stopReason, run.source), { limit: limits.max_new_tokens })}</p>
      {#if run.stopReason === 'eos'}
        <p class="muted">{t('example.end.eos_marker')}</p>
      {/if}
      {@render liveOffer?.()}
    </div>
  {/if}

  {#if repeating}
    <p class="message repetition" data-repetition-note>{t('generation.repetition')}</p>
  {/if}

  <p class="visually-hidden" aria-live="polite">{announcement}</p>
</div>

<style>
  .generation {
    display: grid;
    gap: var(--space-3);
    margin-block: var(--space-4);
  }

  .bar {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-panel);
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 2.75rem;
    padding: var(--space-2) var(--space-4);
    font-weight: 700;
    white-space: nowrap;
    border-radius: var(--radius-pill);
  }

  .back {
    color: var(--color-accent);
    background: var(--color-surface);
    border: 1px solid var(--color-border-strong);
  }

  .next {
    color: var(--color-accent-contrast);
    background: var(--color-accent);
    border: 1px solid var(--color-accent);
  }

  button:disabled {
    color: var(--color-text-muted);
    background: var(--color-surface-raised);
    border: 1px dashed var(--color-border-strong);
    cursor: not-allowed;
  }

  .counter {
    display: grid;
    justify-items: center;
    gap: var(--space-1);
    min-width: 0;
    text-align: center;
  }

  .step {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .generated {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .progress {
    width: 100%;
    max-width: 16rem;
    height: 4px;
    overflow: hidden;
    background: var(--color-border);
    border-radius: var(--radius-pill);
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--color-accent);
    transition: width var(--duration-fast) ease;
  }

  .message {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
  }

  .message p {
    margin: 0;
  }

  .message p + p {
    margin-top: var(--space-2);
  }

  .end {
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border-strong);
    border-inline-start: 4px solid var(--color-accent);
  }

  .repetition {
    font-size: var(--text-sm);
    background: var(--color-surface);
    border: 1px dashed var(--color-border-strong);
  }

  /* Narrow screens: buttons on one row, the counter above them. */
  @media (max-width: 30rem) {
    .bar {
      grid-template-columns: 1fr 1fr;
    }

    .counter {
      grid-column: 1 / -1;
      grid-row: 1;
    }

    button {
      justify-content: center;
      padding-inline: var(--space-3);
    }
  }
</style>
