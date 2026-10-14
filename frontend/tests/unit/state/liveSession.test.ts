// The live-mode state machine (data-model.md "Run" state transitions) with a fake client.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type RunResponse, type WaitOptions } from '../../../src/lib/api/client';
import { limits } from '../../../src/lib/limits';
import { LiveSession } from '../../../src/lib/state/liveSession.svelte';

const FIXTURES = new URL('../../../../contracts/fixtures/api/', import.meta.url);
const run = (
  JSON.parse(readFileSync(new URL('run.json', FIXTURES), 'utf-8')) as { body: RunResponse }
).body;

function fakeClient(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    waitForService: vi.fn(async (_o: WaitOptions) => ({}) as never),
    createRun: vi.fn(async () => run),
    getAttention: vi.fn(),
    getTokenEmbeddings: vi.fn(),
    ...overrides,
  };
}

function session(client = fakeClient()) {
  return { client, live: new LiveSession(() => client as never) };
}

describe('LiveSession', () => {
  it('runs a text: validating → running → ready, with a live run', async () => {
    const { client, live } = session();
    const done = live.runText('The quick brown fox');
    expect(live.state).toBe('validating');
    await done;
    expect(live.state).toBe('ready');
    expect(live.run?.source).toBe('live');
    expect(live.run?.steps).toBe(run.run.steps);
    expect(client.createRun).toHaveBeenCalledWith('The quick brown fox', expect.any(AbortSignal));
  });

  it('shows waking while the service wakes up', async () => {
    let resolve!: () => void;
    const client = fakeClient({
      waitForService: vi.fn(
        (o: WaitOptions) =>
          new Promise((r) => {
            o.onWaking?.();
            resolve = () => r({});
          }),
      ),
    });
    const { live } = session(client);
    const done = live.runText('Hello');
    await Promise.resolve();
    expect(live.state).toBe('waking');
    expect(live.wakingSince).not.toBeNull();
    resolve();
    await done;
    expect(live.state).toBe('ready');
    expect(live.wakingSince).toBeNull();
  });

  it('rejects empty and over-long text without calling the service', async () => {
    const { client, live } = session();
    await live.runText(' \n ');
    expect(live.state).toBe('error');
    expect(live.error).toEqual({ code: 'empty_input', params: {} });

    const text = '😀'.repeat(limits.max_input_chars + 1);
    await live.runText(text);
    expect(live.error).toEqual({
      code: 'input_too_long_chars',
      params: { limit: limits.max_input_chars, actual: limits.max_input_chars + 1 },
    });
    expect(client.waitForService).not.toHaveBeenCalled();
    expect(client.createRun).not.toHaveBeenCalled();
  });

  it('keeps the service error code and params', async () => {
    const client = fakeClient({
      createRun: vi.fn(async () => {
        throw new ApiError('rate_limited', { retry_after_s: 7 }, 429);
      }),
    });
    const { live } = session(client);
    await live.runText('Hello');
    expect(live.state).toBe('error');
    expect(live.error).toEqual({ code: 'rate_limited', params: { retry_after_s: 7 } });
  });

  it('cancel returns to idle and ignores the late result', async () => {
    let resolve!: (r: RunResponse) => void;
    const client = fakeClient({ createRun: vi.fn(() => new Promise((r) => (resolve = r))) });
    const { live } = session(client);
    const done = live.runText('Hello');
    await vi.waitFor(() => expect(live.state).toBe('running'));
    live.cancel();
    expect(live.state).toBe('idle');
    resolve(run);
    await done;
    expect(live.state).toBe('idle');
    expect(live.run).toBeNull();
    expect(live.text).toBe('Hello');
  });

  it('new text after a result returns to idle and drops the run', async () => {
    const { live } = session();
    await live.runText('Hello');
    live.setText('Hello there');
    expect(live.state).toBe('idle');
    expect(live.run).toBeNull();
  });

  it('a version mismatch turns live mode off', async () => {
    const client = fakeClient({
      waitForService: vi.fn(async () => {
        throw new ApiError('version_mismatch');
      }),
    });
    const { live } = session(client);
    await live.enter();
    expect(live.disabled).toBe(true);
    expect(live.error?.code).toBe('version_mismatch');
    await live.runText('Hello');
    expect(client.createRun).not.toHaveBeenCalled();
  });

  it('entering checks the service and settles in idle', async () => {
    const { client, live } = session();
    await live.enter();
    expect(client.waitForService).toHaveBeenCalledTimes(1);
    expect(live.state).toBe('idle');
  });

  it('reset discards the text and the run', async () => {
    const { live } = session();
    await live.runText('Hello');
    live.reset();
    expect(live).toMatchObject({ state: 'idle', text: '', run: null, error: null });
  });
});

describe('liveSession module', () => {
  it('never touches the URL or browser storage (the text stays in memory)', () => {
    const source = readFileSync(
      new URL('../../../src/lib/state/liveSession.svelte.ts', import.meta.url),
      'utf-8',
    );
    const code = source.replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of [
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'document.cookie',
      'history.',
      'location',
      'URLSearchParams',
      "from './url",
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});
