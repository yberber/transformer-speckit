import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { prefixPackedLength } from '../../../src/lib/data/binary';
import { createExampleSource, ExampleLoadError } from '../../../src/lib/data/exampleSource';
import { modelConfig } from '../../../src/lib/model/config';

const ROOT = new URL('../../../../', import.meta.url);
const TINY = new URL('contracts/fixtures/data/tiny-example/', ROOT);
const PUBLIC_DATA = new URL('frontend/public/data/', ROOT);

const realIndex = JSON.parse(readFileSync(new URL('examples/index.json', PUBLIC_DATA), 'utf-8'));
const index = {
  ...realIndex,
  examples: [{ id: 'tiny-example', length: 'short', core: 'tiny-example/core.json' }],
};
const tinyCore = JSON.parse(readFileSync(new URL('core.json', TINY), 'utf-8'));

type Override = (path: string) => Response | undefined;

function bytes(url: URL): Response {
  return new Response(readFileSync(url));
}

function server(override: Override = () => undefined) {
  const calls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    const path = String(input);
    calls.push(path);
    const o = override(path);
    if (o) return o;
    if (path === '/data/examples/index.json') return Response.json(index);
    const tiny = path.match(/^\/data\/examples\/tiny-example\/(.+)$/);
    if (tiny) return bytes(new URL(tiny[1]!, TINY));
    const model = path.match(/^\/data\/model\/(wpe-[0-9-]+\.f32)$/);
    if (model) return bytes(new URL(`model/${model[1]}`, PUBLIC_DATA));
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { calls, source: createExampleSource('/', fetchFn) };
}

const count = (calls: string[], suffix: string) => calls.filter((c) => c.endsWith(suffix)).length;

describe('example source', () => {
  let s: ReturnType<typeof server>;
  beforeEach(() => {
    s = server();
  });

  it('loads index.json and core.json only, until a view asks for more', async () => {
    const run = await s.source.loadExample('tiny-example');
    expect(run.source).toBe('example');
    expect(run.example.text).toBe(tinyCore.example.text);
    expect(run.tokens.length).toBe(run.nInput + run.steps);
    expect(s.calls).toEqual(['/data/examples/index.json', '/data/examples/tiny-example/core.json']);
  });

  it('fetches each attention layer on demand, once', async () => {
    const run = await s.source.loadExample('tiny-example');
    const heads = await run.getAttention(3);
    expect(heads).toHaveLength(modelConfig.nHead);
    expect(heads[0]!.length).toBe(prefixPackedLength(run.tokens.length));
    await run.getAttention(3);
    await Promise.all([run.getAttention(5), run.getAttention(5)]);
    expect(count(s.calls, 'attention-L03.u16')).toBe(1);
    expect(count(s.calls, 'attention-L05.u16')).toBe(1);
    expect(count(s.calls, '.u16')).toBe(2);
    await expect(run.getAttention(0)).rejects.toThrow(RangeError);
    await expect(run.getAttention(modelConfig.nLayer + 1)).rejects.toThrow(RangeError);
  });

  it('fetches token embeddings on demand, once', async () => {
    const run = await s.source.loadExample('tiny-example');
    expect(count(s.calls, '.f32')).toBe(0);
    const emb = await run.getTokenEmbeddings();
    await run.getTokenEmbeddings();
    expect(emb.uniqueIds).toEqual(tinyCore.files.embeddings_token.unique_ids);
    expect(emb.rows.length).toBe(emb.uniqueIds.length * modelConfig.nEmbd);
    expect(count(s.calls, 'embeddings-token.f32')).toBe(1);
  });

  it('loads the example once', async () => {
    const [a, b] = await Promise.all([
      s.source.loadExample('tiny-example'),
      s.source.loadExample('tiny-example'),
    ]);
    expect(a).toBe(b);
    expect(count(s.calls, 'core.json')).toBe(1);
  });

  it('rejects only the call that needs a corrupt or missing file', async () => {
    let broken = true;
    const t = server((path) => {
      if (!broken) return undefined;
      if (path.endsWith('attention-L02.u16')) return new Response(new Uint8Array(10));
      if (path.endsWith('attention-L04.u16')) return new Response('gone', { status: 404 });
      return undefined;
    });
    const run = await t.source.loadExample('tiny-example');

    const corrupt = await run.getAttention(2).catch((e: unknown) => e);
    expect(corrupt).toBeInstanceOf(ExampleLoadError);
    expect((corrupt as ExampleLoadError).kind).toBe('format');
    expect((corrupt as ExampleLoadError).exampleId).toBe('tiny-example');
    const missing = await run.getAttention(4).catch((e: unknown) => e);
    expect((missing as ExampleLoadError).kind).toBe('http');

    // core.json data and the other files stay usable.
    expect(run.predictions).toHaveLength(run.steps + 1);
    expect(await run.getAttention(1)).toHaveLength(modelConfig.nHead);
    expect((await run.getTokenEmbeddings()).uniqueIds.length).toBeGreaterThan(0);

    // A failed load is not cached: once the file is fixed, a retry succeeds.
    broken = false;
    expect(await run.getAttention(2)).toHaveLength(modelConfig.nHead);
    expect(count(t.calls, 'attention-L02.u16')).toBe(2);
  });

  it('isolates a broken core.json to its example', async () => {
    const t = server((path) =>
      path.endsWith('tiny-example/core.json')
        ? Response.json({ format_version: '1.0.0' })
        : undefined,
    );
    const err = await t.source.loadExample('tiny-example').catch((e: unknown) => e);
    expect((err as ExampleLoadError).kind).toBe('format');
    const unknown = await t.source.loadExample('nope').catch((e: unknown) => e);
    expect((unknown as ExampleLoadError).kind).toBe('unknown_example');
    expect(await t.source.loadPositionEmbeddings(1)).toHaveLength(modelConfig.nEmbd);
  });

  it('assembles position embeddings from the shards it needs, each fetched once', async () => {
    const shard0 = readFileSync(new URL('model/wpe-0000-0063.f32', PUBLIC_DATA));
    const first = new Float32Array(shard0.buffer, shard0.byteOffset, shard0.byteLength / 4);
    const d = modelConfig.nEmbd;

    const ten = await s.source.loadPositionEmbeddings(10);
    expect(ten.length).toBe(10 * d);
    expect(Array.from(ten)).toEqual(Array.from(first.subarray(0, 10 * d)));
    expect(count(s.calls, '.f32')).toBe(1);

    const rows = index.position_embeddings[0].shape[0] + 6;
    const more = await s.source.loadPositionEmbeddings(rows);
    expect(more.length).toBe(rows * d);
    expect(count(s.calls, 'wpe-0000-0063.f32')).toBe(1);
    expect(count(s.calls, '.f32')).toBe(2);

    const covered = index.position_embeddings.reduce(
      (n: number, p: { shape: number[] }) => n + p.shape[0]!,
      0,
    );
    await expect(s.source.loadPositionEmbeddings(covered + 1)).rejects.toThrow(RangeError);
  });
});
