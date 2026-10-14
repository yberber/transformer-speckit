<!--
  Every view starts with its name and a one-sentence plain-language explanation (FR-031).
-->
<script lang="ts">
  import { t } from '../lib/i18n/index';
  import type { ViewId } from '../lib/state/viewState.svelte';

  let { view, headingId }: { view: ViewId; headingId?: string } = $props();
</script>

<header class="view-intro">
  <h2 id={headingId}>{t(`view.${view}.name`)}</h2>
  <p class="lead">{t(`view.${view}.intro`)}</p>
</header>

<style>
  .view-intro {
    margin-bottom: var(--space-5);
  }

  .lead {
    max-width: 65ch;
    margin: 0;
    font-size: var(--text-lg);
    color: var(--color-text-muted);
  }
</style>
