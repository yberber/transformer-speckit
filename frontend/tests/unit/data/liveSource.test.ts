// A /runs response becomes RunData whose attention and embeddings come from the API, decoded with
// the same binary decoder as the example files, fetched once per layer and retried on failure.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type {
  AttentionResponse,
  RunResponse,
  TokenEmbeddingsResponse,
} from '../../../src/lib/api/client';
import { decodeEncodedArray, prefixPackedLength } from '../../../src/lib/data/binary';
import { createLiveRun } from '../../../src/lib/data/liveSource';
import { modelConfig } from '../../../src/lib/model/config';

const FIXTURES = new URL('../../../../contracts/fixtures/api/', import.meta.url);
const body = <T>(name: string) =>
  (JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURES), 'utf-8')) as { body: T }).body;

const run = body<RunResponse>('run');
const attention = body<AttentionResponse>('attention');
const embeddings = body<TokenEmbeddingsResponse>('token-embeddings');
const ids = run.run.tokens.map((t) => t.id);

function fakeClient() {
  return {
    getAttention: vi.fn(async (_ids: number[], layer: number) => ({ ...attention, layer })),
    getTokenEmbeddings: vi.fn(async () => embeddings),
  };
}

describe('createLiveRun', () => {
  it('carries the run core as live RunData', () => {
    const live = createLiveRun(run, fakeClient());
    expect(live.source).toBe('live');
    expect(live.nInput).toBe(run.run.n_input);
    expect(live.steps).toBe(run.run.steps);
    expect(live.stopReason).toBe(run.run.stop_reason);
    expect(live.tokens).toEqual(run.run.tokens);
    expect(live.predictions).toEqual(run.run.predictions);
    expect(live.layers).toHaveLength(modelConfig.nLayer);
  });

  it('fetches attention per layer with the run token IDs, once, split by head', async () => {
    const client = fakeClient();
    const live = createLiveRun(run, client);
    const heads = await live.getAttention(1);
    await live.getAttention(1);
    await live.getAttention(2);
    expect(client.getAttention.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      [ids, 1],
      [ids, 2],
    ]);
    const packed = prefixPackedLength(ids.length);
    expect(heads).toHaveLength(modelConfig.nHead);
    expect(heads.every((h) => h.length === packed)).toBe(true);
    const all = decodeEncodedArray(attention.weights);
    expect(Array.from(heads[1]!)).toEqual(Array.from(all.subarray(packed, 2 * packed)));
  });

  it('rejects layers outside the model without a request', async () => {
    const client = fakeClient();
    const live = createLiveRun(run, client);
    await expect(live.getAttention(0)).rejects.toThrow(RangeError);
    await expect(live.getAttention(modelConfig.nLayer + 1)).rejects.toThrow(RangeError);
    expect(client.getAttention).not.toHaveBeenCalled();
  });

  it('fetches token embeddings once and decodes them', async () => {
    const client = fakeClient();
    const live = createLiveRun(run, client);
    const emb = await live.getTokenEmbeddings();
    await live.getTokenEmbeddings();
    expect(client.getTokenEmbeddings).toHaveBeenCalledTimes(1);
    expect(client.getTokenEmbeddings).toHaveBeenCalledWith(ids);
    expect(emb.uniqueIds).toEqual(embeddings.unique_ids);
    expect(emb.rows).toHaveLength(embeddings.unique_ids.length * modelConfig.nEmbd);
  });

  it('forgets a failed request so the view can retry', async () => {
    const client = fakeClient();
    client.getTokenEmbeddings.mockRejectedValueOnce(new Error('offline'));
    const live = createLiveRun(run, client);
    await expect(live.getTokenEmbeddings()).rejects.toThrow('offline');
    await expect(live.getTokenEmbeddings()).resolves.toMatchObject({
      uniqueIds: embeddings.unique_ids,
    });
  });

  it('rejects data whose size does not match its shape', async () => {
    const client = fakeClient();
    client.getAttention.mockResolvedValueOnce({
      ...attention,
      weights: { ...attention.weights, data: attention.weights.data.slice(0, 8) },
    });
    await expect(createLiveRun(run, client).getAttention(1)).rejects.toThrow();
  });
});
