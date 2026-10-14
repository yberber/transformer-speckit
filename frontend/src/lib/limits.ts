// Shared product limits (contracts/limits.json), the same file the inference service loads.
// These are product limits, not architecture numbers; those come from the model config.
import raw from '$contracts/limits.json';

export interface Limits {
  readonly max_input_tokens: number;
  readonly max_new_tokens: number;
  /** Unicode code points: `[...text].length`. */
  readonly max_input_chars: number;
  readonly wait_limit_s: number;
  readonly example_steps: number;
  /** Raw bytes; every data file must be strictly smaller. */
  readonly file_budget_bytes: number;
  readonly initial_load_budget_bytes: number;
}

export const limits: Limits = Object.freeze({
  max_input_tokens: raw.max_input_tokens,
  max_new_tokens: raw.max_new_tokens,
  max_input_chars: raw.max_input_chars,
  wait_limit_s: raw.wait_limit_s,
  example_steps: raw.example_steps,
  file_budget_bytes: raw.file_budget_bytes,
  initial_load_budget_bytes: raw.initial_load_budget_bytes,
});
