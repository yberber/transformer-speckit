<!--
  Every estimate is visibly labelled as a theoretical estimate and links to its formula on "How
  we calculate" (FR-027). The link is a real URL that can be copied or opened in a new tab; a
  plain click switches to the Method view and brings the formula into view and focus.
-->
<script lang="ts">
  import { t } from '../lib/i18n/index';
  import { methodHref, openFormula } from '../lib/state/methodLink';

  let {
    formulaId,
    what,
  }: {
    /** Anchor of the formula on "How we calculate", e.g. `flops-decode-total`. */
    formulaId: string;
    /** What the estimate is, for the link's accessible name (several links share one text). */
    what?: string;
  } = $props();
</script>

<span class="estimate-label" data-estimate-label>
  <span class="badge" data-estimate-badge>{t('estimate.badge')}</span>
  <a
    href={methodHref(formulaId)}
    data-formula-link={formulaId}
    aria-label={what ? t('estimate.how_label', { what }) : undefined}
    onclick={(e) => openFormula(e, formulaId)}>{t('estimate.how')}</a
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
