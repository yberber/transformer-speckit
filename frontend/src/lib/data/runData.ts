// One data interface for both modes (research R4): example files and the live API produce the
// same RunData, so every view works the same in both. Generation step k is the prefix of length
// nInput + k of every per-position array (research R5).
import type { components } from '../../generated/api-types';
import { limits } from '../limits';
import { modelConfig } from '../model/config';
import { prefixPackedLength } from './binary';

type Schemas = components['schemas'];
export type RunCore = Schemas['RunCore'];
export type Token = Schemas['Token'];
export type Candidate = Schemas['Candidate'];
export type Prediction = Schemas['Prediction'];
export type LayerChange = Schemas['LayerChange'];
export type StopReason = RunCore['stop_reason'];
export type RunSource = 'example' | 'live';

export interface TokenEmbeddings {
  /** Token IDs in order of first appearance in the run. */
  uniqueIds: number[];
  /** Row r = token embedding of uniqueIds[r]; length uniqueIds.length × nEmbd. */
  rows: Float32Array;
}

export interface RunData {
  source: RunSource;
  nInput: number;
  steps: number;
  stopReason: StopReason;
  /** Input tokens, then generated tokens: length nInput + steps. */
  tokens: Token[];
  /** Index k = prediction shown at step k: length steps + 1. */
  predictions: Prediction[];
  /** One entry per block, 0-based. */
  layers: LayerChange[];
  /** Attention of one block (1-based), one packed causal triangle per head, for the full run. */
  getAttention(layer1: number): Promise<Float32Array[]>;
  getTokenEmbeddings(): Promise<TokenEmbeddings>;
}

export class RunFormatError extends Error {
  constructor(message: string) {
    super(`Invalid run data: ${message}`);
    this.name = 'RunFormatError';
  }
}

/** Highest step count a run of this source may have. */
export function stepCap(source: RunSource): number {
  return source === 'example' ? limits.example_steps : limits.max_new_tokens;
}

// --- step helpers ---------------------------------------------------------------------------

function prefixLength(run: Pick<RunData, 'nInput' | 'steps'>, k: number): number {
  if (!Number.isInteger(k) || k < 0 || k > run.steps) {
    throw new RangeError(`step ${k} outside 0..${run.steps}`);
  }
  return run.nInput + k;
}

/** Tokens visible at step k: positions [0, nInput + k). */
export function tokensAt(run: RunData, k: number): Token[] {
  return run.tokens.slice(0, prefixLength(run, k));
}

export function predictionAt(run: RunData, k: number): Prediction {
  prefixLength(run, k);
  return run.predictions[k]!;
}

export function changeAt(
  run: RunData,
  layer1: number,
  k: number,
): { attn: number[]; mlp: number[] } {
  const t = prefixLength(run, k);
  const layer = run.layers[layer1 - 1];
  if (!layer) throw new RangeError(`layer ${layer1} outside 1..${run.layers.length}`);
  return { attn: layer.attn_change_pct.slice(0, t), mlp: layer.mlp_change_pct.slice(0, t) };
}

/** Each head's packed attention for the tokens of step k (views, not copies). */
export function attentionAt(run: RunData, heads: Float32Array[], k: number): Float32Array[] {
  const n = prefixPackedLength(prefixLength(run, k));
  return heads.map((h) => h.subarray(0, n));
}

// --- runtime guard --------------------------------------------------------------------------

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function fail(msg: string): never {
  throw new RunFormatError(msg);
}

function checkTokenLike(t: unknown, where: string): asserts t is Token {
  if (typeof t !== 'object' || t === null) fail(`${where} is not an object`);
  const { id, bytes } = t as Record<string, unknown>;
  if (!isInt(id) || id < 0 || id >= modelConfig.vocabSize) fail(`${where}.id out of range`);
  if (!Array.isArray(bytes) || bytes.length < 1) fail(`${where}.bytes is empty`);
  if (!bytes.every((b) => isInt(b) && b >= 0 && b <= 255)) fail(`${where}.bytes not bytes`);
}

function checkPercentages(v: unknown, length: number, where: string): void {
  if (!Array.isArray(v) || v.length !== length) fail(`${where} must have ${length} values`);
  if (!v.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0)) {
    fail(`${where} must be finite and ≥ 0`);
  }
}

const STOP_REASONS: readonly StopReason[] = ['step_limit', 'eos', 'context_limit'];

/**
 * Hand-written guard for a RunCore (no runtime Ajv): the shape from example-data.schema.json
 * plus the consistency rules of contracts/example-data.md rule 3.
 */
export function assertRunCore(obj: unknown, source: RunSource): asserts obj is RunCore {
  if (typeof obj !== 'object' || obj === null) fail('not an object');
  const r = obj as Record<string, unknown>;
  const { n_input: nInput, steps, stop_reason: stop, tokens, predictions, layers } = r;

  if (!isInt(nInput) || nInput < 1 || nInput > limits.max_input_tokens) {
    fail(`n_input must be in 1..${limits.max_input_tokens}`);
  }
  const cap = stepCap(source);
  if (!isInt(steps) || steps < 0 || steps > cap) fail(`steps must be in 0..${cap}`);
  if (!STOP_REASONS.includes(stop as StopReason)) fail('unknown stop_reason');

  if (!Array.isArray(tokens) || tokens.length !== nInput + steps) {
    fail('tokens.length must equal n_input + steps');
  }
  if (tokens.length > modelConfig.nPositions) fail('more tokens than the model context');
  tokens.forEach((t, i) => checkTokenLike(t, `tokens[${i}]`));

  if (!Array.isArray(predictions) || predictions.length !== steps + 1) {
    fail('predictions.length must equal steps + 1');
  }
  predictions.forEach((p, k) => {
    const cands = (p as { candidates?: unknown } | null)?.candidates;
    if (!Array.isArray(cands) || cands.length !== 10) fail(`predictions[${k}] needs 10 candidates`);
    cands.forEach((c, j) => {
      checkTokenLike(c, `predictions[${k}].candidates[${j}]`);
      const prob = (c as { prob?: unknown }).prob;
      if (typeof prob !== 'number' || !(prob > 0 && prob <= 1)) {
        fail(`predictions[${k}].candidates[${j}].prob must be in (0, 1]`);
      }
    });
    for (let j = 1; j < cands.length; j++) {
      const a = cands[j - 1] as Candidate;
      const b = cands[j] as Candidate;
      if (a.prob < b.prob || (a.prob === b.prob && a.id > b.id)) {
        fail(`predictions[${k}] candidates not sorted by prob desc, id asc`);
      }
    }
  });
  // predictions[k-1].candidates[0] is the token appended at step k (k ≥ 1).
  for (let k = 1; k <= steps; k++) {
    const greedy = (predictions[k - 1] as Prediction).candidates[0]!.id;
    if (greedy !== (tokens[nInput + k - 1] as Token).id) {
      fail(`token ${nInput + k - 1} is not the greedy choice of step ${k - 1}`);
    }
  }

  if (!Array.isArray(layers) || layers.length !== modelConfig.nLayer) {
    fail(`layers.length must equal n_layer (${modelConfig.nLayer})`);
  }
  layers.forEach((l, i) => {
    if (typeof l !== 'object' || l === null) fail(`layers[${i}] is not an object`);
    const { attn_change_pct: attn, mlp_change_pct: mlp } = l as Record<string, unknown>;
    checkPercentages(attn, tokens.length, `layers[${i}].attn_change_pct`);
    checkPercentages(mlp, tokens.length, `layers[${i}].mlp_change_pct`);
  });
}
