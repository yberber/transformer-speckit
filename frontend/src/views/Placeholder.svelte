<!--
  Stand-in for a view that is not built yet. It still has the view's heading and intro, so
  navigation, the flow indicator and the accessibility suite cover every view from the start.
-->
<script lang="ts">
  import ViewIntro from '../components/ViewIntro.svelte';
  import { t } from '../lib/i18n/index';
  import type { ViewId } from '../lib/state/viewState.svelte';

  let { view }: { view: ViewId } = $props();
  const headingId = $props.id();
</script>

<section class="view" data-view={view} data-placeholder aria-labelledby={headingId}>
  <ViewIntro {view} {headingId} />
  <div class="panel placeholder">
    <p>{t('view.placeholder')}</p>
  </div>
</section>

<style>
  .placeholder {
    padding: var(--space-6) var(--space-4);
    text-align: center;
  }

  .placeholder p {
    margin: 0;
  }
</style>
