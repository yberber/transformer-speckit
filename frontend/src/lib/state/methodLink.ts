// Links to a formula on "How we calculate" (FR-027). The href is a real, shareable URL; a plain
// click stays in the page, switches to the Method view and brings the formula into view.
import { reducedMotion } from '../motion';
import { serializeUrl } from './url';
import { viewState } from './viewState.svelte';

/**
 * The current state with `view=method` and the formula as fragment (contracts/url-state.md).
 * Text never goes in here. Reactive when read in a template or `$derived`.
 */
export function methodHref(formulaId: string): string {
  const { mode, exampleId, layer, head, step, lang } = viewState;
  return serializeUrl({ mode, exampleId, view: 'method', layer, head, step, lang }, formulaId);
}

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

/** Click handler for a formula link. New tab, new window and download keep browser behavior. */
export function openFormula(e: MouseEvent, formulaId: string): void {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  viewState.setView('method');
  revealAnchor(formulaId);
}
