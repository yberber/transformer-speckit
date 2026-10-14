// Live mode data source: a /runs response becomes the same RunData that example files give
// (research R4), so every view works unchanged. Attention and token embeddings are fetched from
// the API the first time a view asks for them, using the run's own token IDs, and kept in memory
// for this run only. Position embeddings come from the shared static files, as in example mode.
import type { ApiClient, RunResponse } from '../api/client';
import { modelConfig } from '../model/config';
import { decodeEncodedArray, prefixPackedLength } from './binary';
import type { RunData, TokenEmbeddings } from './runData';

export interface LiveRun extends RunData {
  source: 'live';
  model: RunResponse['model'];
}

type DetailClient = Pick<ApiClient, 'getAttention' | 'getTokenEmbeddings'>;

/** Memoize a lazy load, forgetting failures so a later request can retry. */
function memo<K, T>(cache: Map<K, Promise<T>>, key: K, load: () => Promise<T>): Promise<T> {
  let p = cache.get(key);
  if (!p) {
    p = load();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

export function createLiveRun(response: RunResponse, client: DetailClient): LiveRun {
  const { run, model } = response;
  const ids = run.tokens.map((t) => t.id);
  const attention = new Map<number, Promise<Float32Array[]>>();
  const embeddings = new Map<'token', Promise<TokenEmbeddings>>();

  return {
    source: 'live',
    model,
    nInput: run.n_input,
    steps: run.steps,
    stopReason: run.stop_reason,
    tokens: run.tokens,
    predictions: run.predictions,
    layers: run.layers,
    getAttention(layer1: number) {
      if (!Number.isInteger(layer1) || layer1 < 1 || layer1 > modelConfig.nLayer) {
        return Promise.reject(new RangeError(`layer ${layer1} outside 1..${modelConfig.nLayer}`));
      }
      return memo(attention, layer1, async () => {
        const res = await client.getAttention(ids, layer1);
        const values = decodeEncodedArray(res.weights);
        const packed = prefixPackedLength(ids.length);
        return Array.from({ length: modelConfig.nHead }, (_, h) =>
          values.subarray(h * packed, (h + 1) * packed),
        );
      });
    },
    getTokenEmbeddings() {
      return memo(embeddings, 'token', async () => {
        const res = await client.getTokenEmbeddings(ids);
        return { uniqueIds: res.unique_ids, rows: decodeEncodedArray(res.embeddings) };
      });
    },
  };
}
