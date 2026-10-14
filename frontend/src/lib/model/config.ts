// The official GPT-2 small config, copied verbatim from the pinned model revision by
// backend/tools/generate_examples.py. Every architecture number on the site is read or computed
// from it (Principle I); none is written in code.
import rawConfig from '../../generated/gpt2-config.json';

export interface ModelConfig {
  nLayer: number;
  nHead: number;
  nEmbd: number;
  /** MLP hidden size (f). */
  nInner: number;
  /** Size of one attention head: nEmbd / nHead. */
  dHead: number;
  vocabSize: number;
  nPositions: number;
  activationFunction: string;
  layerNormEpsilon: number;
  tieWordEmbeddings: boolean;
  eosTokenId: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(`Invalid model config: ${message}`);
    this.name = 'ConfigError';
  }
}

const POSITIVE_INTS = ['n_layer', 'n_head', 'n_embd', 'vocab_size', 'n_positions'] as const;

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

export function validateConfig(raw: unknown): ModelConfig {
  if (typeof raw !== 'object' || raw === null) throw new ConfigError('not an object');
  const c = raw as Record<string, unknown>;
  for (const key of POSITIVE_INTS) {
    if (!(key in c)) throw new ConfigError(`missing ${key}`);
    if (!isPositiveInt(c[key])) throw new ConfigError(`${key} must be a positive integer`);
  }
  const nEmbd = c.n_embd as number;
  const nHead = c.n_head as number;
  if (nEmbd % nHead !== 0) throw new ConfigError('n_embd is not divisible by n_head');

  // HF GPT-2 semantics (transformers GPT2Block): n_inner = null means an MLP of 4 × n_embd.
  // The factor 4 is part of the architecture definition, not a model size.
  let nInner = 4 * nEmbd;
  if (c.n_inner !== undefined && c.n_inner !== null) {
    if (!isPositiveInt(c.n_inner)) throw new ConfigError('n_inner must be a positive integer');
    nInner = c.n_inner;
  }

  const eos = c.eos_token_id;
  if (typeof eos !== 'number' || !Number.isInteger(eos) || eos < 0) {
    throw new ConfigError('eos_token_id must be a non-negative integer');
  }
  if (eos >= (c.vocab_size as number)) throw new ConfigError('eos_token_id outside vocabulary');
  if (typeof c.activation_function !== 'string' || c.activation_function === '') {
    throw new ConfigError('missing activation_function');
  }
  const eps = c.layer_norm_epsilon;
  if (typeof eps !== 'number' || !(eps > 0) || !Number.isFinite(eps)) {
    throw new ConfigError('layer_norm_epsilon must be a positive number');
  }
  // HF PretrainedConfig default: the LM head shares the token embedding (wte) weights.
  const tie = c.tie_word_embeddings ?? true;
  if (typeof tie !== 'boolean') throw new ConfigError('tie_word_embeddings must be a boolean');

  return {
    nLayer: c.n_layer as number,
    nHead,
    nEmbd,
    nInner,
    dHead: nEmbd / nHead,
    vocabSize: c.vocab_size as number,
    nPositions: c.n_positions as number,
    activationFunction: c.activation_function,
    layerNormEpsilon: eps,
    tieWordEmbeddings: tie,
    eosTokenId: eos,
  };
}

export const modelConfig: ModelConfig = validateConfig(rawConfig);

/** i18n key of the activation's human-readable name, e.g. gelu_new → "GELU (tanh approximation)". */
export function activationLabelKey(config: ModelConfig = modelConfig): string {
  return `model.activation.${config.activationFunction}`;
}
