// Links to a formula on "How we calculate" (FR-027). The href is a real, shareable URL; a plain
// click stays in the page, switches to the Method view and brings the formula into view.
import { reducedMotion } from '../motion';
import { viewState } from './viewState.svelte';

/**
 * The current state with `view=method` and the formula as fragment, keys in the order of
 * contracts/url-state.md (defaults left out except `ex` and `lang`). Text never goes in here.
 * Reactive when read in a template or `$derived`.
 */
export function methodHref(formulaId: string): string {
  const params = new URLSearchParams();
  if (viewState.mode === 'live') params.set('mode', 'live');
  else if (viewState.exampleId) params.set('ex', viewState.exampleId);
  params.set('view', 'method');
  if (viewState.layer !== 1) params.set('layer', String(viewState.layer));
  if (viewState.head !== 1) params.set('head', String(viewState.head));
  if (viewState.step !== 0) params.set('step', String(viewState.step));
  params.set('lang', viewState.lang);
  return `?${params}#${formulaId}`;
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
