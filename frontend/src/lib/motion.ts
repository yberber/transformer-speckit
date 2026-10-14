// Reduced motion (FR-036): when the system asks for it, animations become instant state changes
// that show the same information.
import { MediaQuery } from 'svelte/reactivity';

const query = new MediaQuery('(prefers-reduced-motion: reduce)', false);

/** Reactive: `reducedMotion.current` follows the system setting while the page is open. */
export const reducedMotion = {
  get current(): boolean {
    return query.current;
  },
};

/** Animation duration to use: `ms`, or 0 when reduced motion is requested. */
export function duration(ms: number): number {
  return reducedMotion.current ? 0 : ms;
}
