// FR-015, data-model "EmbeddingVectors": per position, the token embedding (row of wte via the
// unique_ids index), the position embedding (row of wpe from the shared shards) and their float32
// sum, with all nEmbd dimensions. Checked on the tiny-example fixture.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildEmbeddingVectors } from '../../../src/lib/data/embeddings';
import { createExampleSource, type ExampleRun } from '../../../src/lib/data/exampleSource';
import { modelConfig } from '../../../src/lib/model/config';

const ROOT = new URL('../../../../', import.meta.url);
const TINY = new URL('contracts/fixtures/data/tiny-example/', ROOT);
const PUBLIC_DATA = new URL('frontend/public/data/', ROOT);

const realIndex = JSON.parse(readFileSync(new URL('examples/index.json', PUBLIC_DATA), 'utf-8'));
const tinyCore = JSON.parse(readFileSync(new URL('core.json', TINY), 'utf-8'));
const index = {
  ...realIndex,
  examples: [
    {
      id: 'tiny-example',
      length: 'short',
      n_input: tinyCore.run.n_input,
      core: 'tiny-example/core.json',
    },
  ],
};

function f32(url: URL): Float32Array {
  const buf = readFileSync(url);
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const fetchFn = (async (input: RequestInfo | URL) => {
  const path = String(input);
  if (path === '/data/examples/index.json') return Response.json(index);
  const tiny = path.match(/^\/data\/examples\/tiny-example\/(.+)$/);
  if (tiny) return new Response(readFileSync(new URL(tiny[1]!, TINY)));
  const model = path.match(/^\/data\/model\/(wpe-[0-9-]+\.f32)$/);
  if (model) return new Response(readFileSync(new URL(`model/${model[1]}`, PUBLIC_DATA)));
  return new Response('not found', { status: 404 });
}) as typeof fetch;

const source = createExampleSource('/', fetchFn);
const d = modelConfig.nEmbd;
const wteRows = f32(new URL('embeddings-token.f32', TINY));
const uniqueIds: number[] = tinyCore.files.embeddings_token.unique_ids;
const firstShard = index.position_embeddings.find(
  (s: { first_position: number }) => s.first_position === 0,
);
const wpe = f32(new URL(firstShard.path, new URL('examples/index.json', PUBLIC_DATA)));

describe('buildEmbeddingVectors', () => {
  let run: ExampleRun;
  beforeAll(async () => {
    run = await source.loadExample('tiny-example');
  });

  it('returns one entry per visible position at each step', async () => {
    for (let k = 0; k <= run.steps; k++) {
      const vectors = await buildEmbeddingVectors(run, k, source.loadPositionEmbeddings);
      expect(vectors.map((v) => v.position)).toEqual(
        Array.from({ length: run.nInput + k }, (_, i) => i),
      );
    }
  });

  it('takes token rows by unique_ids index and position rows from the shards', async () => {
    const vectors = await buildEmbeddingVectors(run, run.steps, source.loadPositionEmbeddings);
    for (const v of vectors) {
      const r = uniqueIds.indexOf(run.tokens[v.position]!.id);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(v.token).toHaveLength(d);
      expect(v.position_).toHaveLength(d);
      expect(v.sum).toHaveLength(d);
      expect(Array.from(v.token)).toEqual(Array.from(wteRows.subarray(r * d, (r + 1) * d)));
      expect(Array.from(v.position_)).toEqual(
        Array.from(wpe.subarray(v.position * d, (v.position + 1) * d)),
      );
    }
  });

  it('sums in float32, element by element', async () => {
    const vectors = await buildEmbeddingVectors(run, run.steps, source.loadPositionEmbeddings);
    for (const v of vectors) {
      expect(v.sum).toBeInstanceOf(Float32Array);
      for (let i = 0; i < d; i++) {
        expect(v.sum[i]).toBe(Math.fround(v.token[i]! + v.position_[i]!));
      }
    }
  });

  it('rejects a step outside the run', async () => {
    await expect(
      buildEmbeddingVectors(run, run.steps + 1, source.loadPositionEmbeddings),
    ).rejects.toThrow(RangeError);
  });
});
