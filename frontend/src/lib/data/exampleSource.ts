// Example mode data source: static files under data/ (contracts/example-data.md). Only index.json
// and the selected example's core.json load up front; attention and embedding files load the
// first time a view asks for them and are kept in memory. A broken file fails only the request
// that needed it (Principle V).
import type { components } from '../../generated/api-types';
import { modelConfig } from '../model/config';
import { DataFormatError, decodeBinary, prefixPackedLength, type ArraySpec } from './binary';
import {
  assertRunCore,
  RunFormatError,
  type RunCore,
  type RunData,
  type TokenEmbeddings,
} from './runData';

type Schemas = components['schemas'];
export type ModelRef = Schemas['ModelRef'];
export type ExampleLength = 'short' | 'medium' | 'long';

interface BinaryFile extends ArraySpec {
  path: string;
  bytes: number;
  sha256: string;
}

export interface ExampleEntry {
  id: string;
  length: ExampleLength;
  /** Input token count, so the picker needs no other example's core.json. */
  n_input: number;
  core: string;
}

export interface ExampleIndex {
  format_version: string;
  model: ModelRef;
  examples: ExampleEntry[];
  position_embeddings: (BinaryFile & { first_position: number })[];
}

interface ExampleCore {
  format_version: string;
  example: { id: string; length: ExampleLength; text: string };
  model: ModelRef;
  run: unknown;
  files: { embeddings_token: BinaryFile & { unique_ids: number[] }; attention: BinaryFile[] };
}

export interface ExampleRun extends RunData {
  source: 'example';
  example: { id: string; length: ExampleLength; text: string };
  model: ModelRef;
}

export type LoadErrorKind = 'network' | 'http' | 'format' | 'unknown_example';

export class ExampleLoadError extends Error {
  constructor(
    readonly exampleId: string | null,
    readonly kind: LoadErrorKind,
    detail: string,
  ) {
    super(`${exampleId ?? 'example index'}: ${kind}: ${detail}`);
    this.name = 'ExampleLoadError';
  }
}

type Fetch = typeof fetch;

/** Resolve `rel` against the URL of the file that names it (paths are relative to that file). */
function resolve(rel: string, from: string): string {
  try {
    return new URL(rel, new URL(from)).href;
  } catch {
    const url = new URL(rel, new URL(from, 'http://relative.invalid'));
    return url.pathname + url.search;
  }
}

function assertIndex(obj: unknown): asserts obj is ExampleIndex {
  const i = obj as Partial<ExampleIndex> | null;
  if (
    !i ||
    i.format_version !== '1.1.0' ||
    !i.model ||
    !Array.isArray(i.examples) ||
    i.examples.length === 0 ||
    !i.examples.every(
      (e) =>
        e &&
        typeof e.id === 'string' &&
        typeof e.core === 'string' &&
        Number.isInteger(e.n_input) &&
        e.n_input >= 1,
    ) ||
    !Array.isArray(i.position_embeddings)
  ) {
    throw new DataFormatError('index.json does not match ExampleIndex');
  }
}

function assertCore(obj: unknown, id: string): asserts obj is ExampleCore {
  const c = obj as Partial<ExampleCore> | null;
  if (!c || c.format_version !== '1.1.0' || c.example?.id !== id || !c.model || !c.files) {
    throw new DataFormatError('core.json does not match ExampleCore');
  }
  assertRunCore(c.run, 'example');
  if (!Array.isArray(c.files.attention) || c.files.attention.length !== modelConfig.nLayer) {
    throw new DataFormatError('core.json must list one attention file per layer');
  }
}

export function createExampleSource(baseUrl: string, fetchFn: Fetch = (...a) => fetch(...a)) {
  const indexUrl = `${baseUrl}data/examples/index.json`;
  let indexPromise: Promise<ExampleIndex> | null = null;
  const examples = new Map<string, Promise<ExampleRun>>();
  const shards = new Map<string, Promise<Float32Array>>();

  async function get(url: string, exampleId: string | null): Promise<Response> {
    let res: Response;
    try {
      res = await fetchFn(url);
    } catch (e) {
      throw new ExampleLoadError(exampleId, 'network', String(e));
    }
    if (!res.ok) throw new ExampleLoadError(exampleId, 'http', `${res.status} for ${url}`);
    return res;
  }

  async function getJson(url: string, exampleId: string | null): Promise<unknown> {
    const res = await get(url, exampleId);
    try {
      return await res.json();
    } catch {
      throw new ExampleLoadError(exampleId, 'format', `${url} is not JSON`);
    }
  }

  async function getBinary(
    url: string,
    spec: ArraySpec,
    exampleId: string | null,
  ): Promise<Float32Array> {
    const buf = await (await get(url, exampleId)).arrayBuffer();
    try {
      return decodeBinary(buf, spec);
    } catch (e) {
      throw new ExampleLoadError(exampleId, 'format', `${url}: ${(e as Error).message}`);
    }
  }

  /** Memoize a lazy load, forgetting failures so a later request can retry. */
  function memo<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>) {
    let p = cache.get(key);
    if (!p) {
      p = load();
      cache.set(key, p);
      p.catch(() => cache.delete(key));
    }
    return p;
  }

  function loadIndex(): Promise<ExampleIndex> {
    if (!indexPromise) {
      indexPromise = getJson(indexUrl, null).then((obj) => {
        try {
          assertIndex(obj);
        } catch (e) {
          throw new ExampleLoadError(null, 'format', (e as Error).message);
        }
        return obj;
      });
      indexPromise.catch(() => (indexPromise = null));
    }
    return indexPromise;
  }

  async function fetchExample(id: string): Promise<ExampleRun> {
    const index = await loadIndex();
    const entry = index.examples.find((e) => e.id === id);
    if (!entry) throw new ExampleLoadError(id, 'unknown_example', 'not in index.json');
    const coreUrl = resolve(entry.core, indexUrl);
    const core = await getJson(coreUrl, id);
    try {
      assertCore(core, id);
    } catch (e) {
      if (e instanceof DataFormatError || e instanceof RunFormatError) {
        throw new ExampleLoadError(id, 'format', e.message);
      }
      throw e;
    }
    const run = core.run as RunCore; // checked by assertCore
    const t = run.tokens.length;
    const attention = new Map<string, Promise<Float32Array[]>>();
    const embeddings = new Map<string, Promise<TokenEmbeddings>>();

    return {
      source: 'example',
      example: core.example,
      model: core.model,
      nInput: run.n_input,
      steps: run.steps,
      stopReason: run.stop_reason,
      tokens: run.tokens,
      predictions: run.predictions,
      layers: run.layers,
      getAttention(layer1: number) {
        const file = core.files.attention[layer1 - 1];
        if (!Number.isInteger(layer1) || !file) {
          return Promise.reject(new RangeError(`layer ${layer1} outside 1..${modelConfig.nLayer}`));
        }
        return memo(attention, String(layer1), async () => {
          const packed = prefixPackedLength(t);
          if (file.shape[0] !== modelConfig.nHead || file.shape[1] !== packed) {
            throw new ExampleLoadError(id, 'format', `${file.path}: unexpected shape`);
          }
          const values = await getBinary(resolve(file.path, coreUrl), file, id);
          return Array.from({ length: modelConfig.nHead }, (_, h) =>
            values.subarray(h * packed, (h + 1) * packed),
          );
        });
      },
      getTokenEmbeddings() {
        return memo(embeddings, 'token', async () => {
          const file = core.files.embeddings_token;
          if (file.shape[0] !== file.unique_ids.length || file.shape[1] !== modelConfig.nEmbd) {
            throw new ExampleLoadError(id, 'format', `${file.path}: unexpected shape`);
          }
          const rows = await getBinary(resolve(file.path, coreUrl), file, id);
          return { uniqueIds: file.unique_ids, rows };
        });
      },
    };
  }

  function loadExample(id: string): Promise<ExampleRun> {
    return memo(examples, id, () => fetchExample(id));
  }

  /**
   * Position embeddings for positions 0..count-1, row-major [count × nEmbd], from the shared
   * wpe shards (used by both modes).
   */
  async function loadPositionEmbeddings(count: number): Promise<Float32Array> {
    const index = await loadIndex();
    const d = modelConfig.nEmbd;
    const out = new Float32Array(count * d);
    let covered = 0;
    for (const shard of [...index.position_embeddings].sort(
      (a, b) => a.first_position - b.first_position,
    )) {
      if (covered >= count) break;
      if (shard.first_position !== covered || shard.shape[1] !== d) {
        throw new ExampleLoadError(null, 'format', `${shard.path}: unexpected layout`);
      }
      const rows = await memo(shards, shard.path, () =>
        getBinary(resolve(shard.path, indexUrl), shard, null),
      );
      const take = Math.min(shard.shape[0]!, count - covered);
      out.set(rows.subarray(0, take * d), covered * d);
      covered += take;
    }
    if (covered < count) {
      throw new RangeError(`position embeddings cover ${covered} positions, ${count} requested`);
    }
    return out;
  }

  return { loadIndex, loadExample, loadPositionEmbeddings };
}

const defaultSource = createExampleSource(import.meta.env.BASE_URL);

export const loadIndex = defaultSource.loadIndex;
export const loadExample = defaultSource.loadExample;
export const loadPositionEmbeddings = defaultSource.loadPositionEmbeddings;
