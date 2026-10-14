<!--
  Navigation between views: the flow views grouped as "Inside the machine", in the order data
  flows through the model, then the reference views (FR-021). Entries are links with
  aria-current="page"; a plain click switches the view without reloading.
-->
<script lang="ts">
  import { t } from '../lib/i18n/index';
  import { FLOW_VIEWS, REFERENCE_VIEWS, type ViewId } from '../lib/state/viewState.svelte';

  let { current, onselect }: { current: ViewId; onselect: (view: ViewId) => void } = $props();

  const groups = [
    { key: 'machine', label: 'nav.group.machine', views: FLOW_VIEWS },
    { key: 'reference', label: 'nav.group.reference', views: REFERENCE_VIEWS },
  ] as const;

  const uid = $props.id();

  function select(event: MouseEvent, view: ViewId): void {
    // Let modified clicks (new tab, new window) behave like normal links.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onselect(view);
  }
</script>

<nav class="view-nav" aria-label={t('nav.label')}>
  {#each groups as group (group.key)}
    <div class="group {group.key}">
      <span class="group-label" id="{uid}-{group.key}">{t(group.label)}</span>
      <ul aria-labelledby="{uid}-{group.key}">
        {#each group.views as view (view)}
          <li>
            <a
              href="?view={view}"
              data-view={view}
              aria-current={view === current ? 'page' : undefined}
              onclick={(e) => select(e, view)}>{t(`view.${view}.name`)}</a
            >
          </li>
        {/each}
      </ul>
    </div>
  {/each}
</nav>

<style>
  .view-nav {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3) var(--space-5);
  }

  .group {
    min-width: 0;
  }

  .group-label {
    display: block;
    margin-bottom: var(--space-1);
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  ul {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  a {
    display: inline-flex;
    align-items: center;
    min-height: 2.5rem;
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text);
    text-decoration: none;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-pill);
  }

  a:hover {
    border-color: var(--color-border-strong);
  }

  a[aria-current='page'] {
    color: var(--color-accent-contrast);
    background: var(--color-accent);
    border-color: var(--color-accent);
    text-decoration: underline;
    text-decoration-thickness: 2px;
    text-underline-offset: 0.3em;
  }
</style>
