<!--
  Every estimate is visibly labelled as a theoretical estimate and links to its formula on "How
  we calculate" (FR-027). The link is a real URL that can be copied or opened in a new tab; a
  plain click switches to the Method view and brings the formula into view and focus.
-->
<script lang="ts">
  import { t } from '../lib/i18n/index';
  import { reducedMotion } from '../lib/motion';
  import { viewState } from '../lib/state/viewState.svelte';

  let {
    formulaId,
    what,
  }: {
    /** Anchor of the formula on "How we calculate", e.g. `flops-decode-total`. */
    formulaId: string;
    /** What the estimate is, for the link's accessible name (several links share one text). */
    what?: string;
  } = $props();

  /**
   * The current state with `view=method` and the formula as fragment, keys in the order of
   * contracts/url-state.md (defaults left out except `ex` and `lang`). Text never goes in here.
   */
  const href = $derived.by(() => {
    const params = new URLSearchParams();
    if (viewState.mode === 'live') params.set('mode', 'live');
    else if (viewState.exampleId) params.set('ex', viewState.exampleId);
    params.set('view', 'method');
    if (viewState.layer !== 1) params.set('layer', String(viewState.layer));
    if (viewState.head !== 1) params.set('head', String(viewState.head));
    if (viewState.step !== 0) params.set('step', String(viewState.step));
    params.set('lang', viewState.lang);
    return `?${params}#${formulaId}`;
  });

  /** Waits for the lazily loaded Method view to render the anchor, then shows and focuses it. */
  function revealAnchor(id: string): void {
    const deadline = performance.now() + 5000;
    const find = () => {
      const target = document.getElementById(id);
      if (!target) {
        if (performance.now() < deadline) requestAnimationFrame(find);
        return;
      }
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.scrollIntoView({
        block: 'start',
        behavior: reducedMotion.current ? 'auto' : 'smooth',
      });
      target.focus({ preventScroll: true });
    };
    requestAnimationFrame(find);
  }

  function open(e: MouseEvent): void {
    // New tab, new window and download keep the browser's own behavior.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const id = formulaId;
    viewState.setView('method');
    revealAnchor(id);
  }
</script>

<span class="estimate-label" data-estimate-label>
  <span class="badge" data-estimate-badge>{t('estimate.badge')}</span>
  <a
    {href}
    data-formula-link={formulaId}
    aria-label={what ? t('estimate.how_label', { what }) : undefined}
    onclick={open}>{t('estimate.how')}</a
  >
</span>

<style>
  .estimate-label {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    font-size: var(--text-sm);
    line-height: 1.3;
  }

  .badge {
    padding: 0.1em 0.6em;
    color: var(--color-text-muted);
    border: 1px dashed var(--color-border-strong);
    border-radius: var(--radius-pill);
    white-space: nowrap;
  }

  a {
    font-weight: 600;
    color: var(--color-accent);
    text-underline-offset: 0.15em;
  }

  /* On a dark machine panel the page colors lack contrast in the light theme. */
  :global(.panel) .badge {
    color: var(--color-panel-muted);
    border-color: var(--color-panel-muted);
  }

  :global(.panel) a {
    color: var(--color-panel-text);
  }
</style>
