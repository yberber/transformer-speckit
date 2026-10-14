// Rules for stepping through a run one token at a time (data-model.md "GenerationStep"). Step k
// shows the input plus the first k generated tokens; "Next token" works until the last step.
import type { MessageKey } from '../i18n/index';
import type { RunData, RunSource, StopReason, Token } from '../data/runData';

/** True if there is a precomputed token after step k. */
export function canAdvance(run: Pick<RunData, 'steps'>, k: number): boolean {
  return k < run.steps;
}

/** The message shown at the last step, which explains why the run stopped there. */
export function endMessageKey(stopReason: StopReason, source: RunSource = 'example'): MessageKey {
  return `${source}.end.${stopReason}`;
}

const NGRAM = 3;

/**
 * True if, within the tokens visible at step k, some sequence of 3 token IDs occurs at least
 * twice and the later occurrence includes a generated token. Greedy decoding often loops like
 * this, and the UI says that it is normal.
 */
export function detectRepetition(
  tokens: readonly Pick<Token, 'id'>[],
  nInput: number,
  k: number,
): boolean {
  const end = Math.min(tokens.length, nInput + k);
  const seen = new Set<string>();
  for (let start = 0; start + NGRAM <= end; start++) {
    const key = tokens
      .slice(start, start + NGRAM)
      .map((t) => t.id)
      .join(',');
    // The occurrence at `start` is the later one; it includes a generated token if it ends at or
    // after the first generated position.
    if (seen.has(key) && start + NGRAM - 1 >= nInput) return true;
    seen.add(key);
  }
  return false;
}
