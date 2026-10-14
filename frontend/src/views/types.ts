// Props every view receives from App.svelte. `run` is null while no run is loaded (or loading it
// failed); views that need it are only shown once it is there.
import type { RunData } from '../lib/data/runData';
import type { ViewId } from '../lib/state/views';

export interface ViewProps {
  view: ViewId;
  run: RunData | null;
  /** Current generation step, 0..run.steps. */
  step: number;
}
