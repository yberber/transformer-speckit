// Tracks which glossary terms have already appeared in the current view, so a term is explained
// inline only the first time (FR-030). Each view creates one registry; Term components find it
// through Svelte context.
import { getContext, setContext } from 'svelte';

const KEY = Symbol('term-registry');

export interface TermRegistry {
  /** True if `owner` is (or now becomes) the first appearance of term `id` in this view. */
  claim(id: string, owner: object): boolean;
  release(id: string, owner: object): void;
}

/** Create the registry for a view. Call during the view component's initialization. */
export function createTermRegistry(): TermRegistry {
  const first = new Map<string, object>();
  const registry: TermRegistry = {
    claim(id, owner) {
      const current = first.get(id);
      if (current === undefined) {
        first.set(id, owner);
        return true;
      }
      return current === owner;
    },
    release(id, owner) {
      if (first.get(id) === owner) first.delete(id);
    },
  };
  setContext(KEY, registry);
  return registry;
}

export function getTermRegistry(): TermRegistry | undefined {
  return getContext<TermRegistry | undefined>(KEY);
}
