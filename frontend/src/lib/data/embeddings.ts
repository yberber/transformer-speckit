// The three vectors the Embeddings view shows per token (FR-015, data-model "EmbeddingVectors"):
// the token embedding (row of wte), the position embedding (row of wpe) and their sum, which is
// what the first block receives. All nEmbd dimensions are kept; nothing is sampled.
import { modelConfig } from '../model/config';
import { loadPositionEmbeddings } from './exampleSource';
import { tokensAt, type RunData, type TokenEmbeddings } from './runData';

export interface EmbeddingVectors {
  /** 0-based token position. */
  position: number;
  /** Token embedding: the wte row of this token's ID. */
  token: Float32Array;
  /** Position embedding: the wpe row of this position. */
  position_: Float32Array;
  /** token + position_, added in float32 like the model does. */
  sum: Float32Array;
}

type LoadPositions = (count: number) => Promise<Float32Array>;

/** Row index of each token ID in TokenEmbeddings.rows, built once per embeddings object. */
const rowIndexCache = new WeakMap<TokenEmbeddings, Map<number, number>>();

function rowIndex(emb: TokenEmbeddings): Map<number, number> {
  let map = rowIndexCache.get(emb);
  if (!map) {
    map = new Map(emb.uniqueIds.map((id, r) => [id, r]));
    rowIndexCache.set(emb, map);
  }
  return map;
}

/** Embedding vectors for positions [0, nInput + k). Vectors are views into shared buffers. */
export async function buildEmbeddingVectors(
  run: RunData,
  k: number,
  loadPositions: LoadPositions = loadPositionEmbeddings,
): Promise<EmbeddingVectors[]> {
  const tokens = tokensAt(run, k);
  const d = modelConfig.nEmbd;
  const [emb, wpe] = await Promise.all([run.getTokenEmbeddings(), loadPositions(tokens.length)]);
  const rows = rowIndex(emb);
  const sums = new Float32Array(tokens.length * d);

  return tokens.map((t, position) => {
    const r = rows.get(t.id);
    if (r === undefined) throw new RangeError(`no token embedding for token ID ${t.id}`);
    const token = emb.rows.subarray(r * d, (r + 1) * d);
    const position_ = wpe.subarray(position * d, (position + 1) * d);
    const sum = sums.subarray(position * d, (position + 1) * d);
    for (let i = 0; i < d; i++) sum[i] = token[i]! + position_[i]!;
    return { position, token, position_, sum };
  });
}
