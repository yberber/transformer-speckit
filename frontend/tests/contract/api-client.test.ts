// The live-mode API client against the shared contract fixtures (Principle IX, research R11,
// R13). Every fixture body is first validated with Ajv against the OpenAPI component schemas,
// so the client is never tested against a response the service could not send.
import { readdirSync, readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { parse as parseYaml } from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, type ApiErrorCode } from '../../src/lib/api/client';
import { limits } from '../../src/lib/limits';

const ROOT = new URL('../../../', import.meta.url);
const CONTRACTS = new URL('contracts/', ROOT);
const FIXTURES = new URL('fixtures/api/', CONTRACTS);
const OPENAPI_ID = 'https://inside-the-transformer/contracts/inference-api.openapi.yaml';
const BASE = 'http://api.test';

interface Fixture {
  request?: Record<string, unknown>;
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

const fixtures = Object.fromEntries(
  readdirSync(FIXTURES)
    .filter((f) => f.endsWith('.json'))
    .map((f) => [
      f.replace(/\.json$/, ''),
      JSON.parse(readFileSync(new URL(f, FIXTURES), 'utf-8')) as Fixture,
    ]),
);
const fixture = (name: string): Fixture => {
  const f = fixtures[name];
  if (!f) throw new Error(`no fixture ${name}`);
  return structuredClone(f);
};
const errorNames = Object.keys(fixtures).filter((n) => n.startsWith('error-'));

// --- schemas: the OpenAPI components as one JSON Schema, external $ref resolved by $id -------

const openapi = parseYaml(readFileSync(new URL('inference-api.openapi.yaml', CONTRACTS), 'utf-8'));
const components = JSON.parse(
  JSON.stringify(openapi.components.schemas).replaceAll('#/components/schemas/', '#/$defs/'),
) as Record<string, unknown>;
const dataSchema = JSON.parse(
  readFileSync(new URL('example-data.schema.json', CONTRACTS), 'utf-8'),
) as { $id: string };
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(dataSchema);
ajv.addSchema({ $id: OPENAPI_ID, $defs: components });

function expectValid(body: unknown, schema: string): void {
  const validate = ajv.getSchema(`${OPENAPI_ID}#/$defs/${schema}`);
  if (!validate) throw new Error(`no schema ${schema}`);
  expect(validate(body), ajv.errorsText(validate.errors)).toBe(true);
}

const FIXTURE_SCHEMAS: Record<string, [string | null, string]> = {
  health: [null, 'Health'],
  run: ['RunRequest', 'RunResponse'],
  attention: ['AttentionRequest', 'AttentionResponse'],
  'token-embeddings': ['TokenIdsRequest', 'TokenEmbeddingsResponse'],
};

describe('fixtures against the OpenAPI contract', () => {
  it('there is one fixture per success response and per error code', () => {
    const codes = openapi.components.schemas.ErrorCode.enum as string[];
    expect(Object.keys(fixtures).sort()).toEqual(
      [...Object.keys(FIXTURE_SCHEMAS), ...codes.map((c) => `error-${c}`)].sort(),
    );
  });

  it.each(Object.entries(FIXTURE_SCHEMAS))('%s matches its schemas', (name, [req, body]) => {
    const f = fixture(name);
    expect(f.status).toBe(200);
    expectValid(f.body, body);
    if (req) expectValid(f.request, req);
  });

  it.each(errorNames)('%s is a valid Error', (name) => {
    const f = fixture(name);
    expectValid(f.body, 'Error');
    expect((f.body as { error: { code: string } }).error.code).toBe(name.slice('error-'.length));
  });
});

// --- mocked fetch ----------------------------------------------------------------------------

type Handler = (url: string, init: RequestInit) => Promise<Response> | Response;
interface Call {
  url: string;
  init: RequestInit;
}

let calls: Call[];

function mockFetch(handler: Handler): typeof fetch {
  calls = [];
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
}

function respond(f: Fixture): Response {
  return new Response(JSON.stringify(f.body), {
    status: f.status,
    headers: { 'content-type': 'application/json', ...f.headers },
  });
}

const health = fixture('health').body as { model: { revision: string } };
const REVISION = health.model.revision;

function client(handler: Handler, revision = REVISION) {
  return createApiClient({
    baseUrl: BASE,
    fetch: mockFetch(handler),
    expectedRevision: async () => revision,
  });
}

/** Rejects with the code, never resolving with partial data. */
async function expectCode(p: Promise<unknown>, code: ApiErrorCode): Promise<ApiError> {
  const err = await p.then(
    () => {
      throw new Error(`expected ${code}, got a result`);
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).code).toBe(code);
  return err as ApiError;
}

const run = fixture('run');
const runIds = (run.body as { run: { tokens: { id: number }[] } }).run.tokens.map((t) => t.id);

// --- model requests --------------------------------------------------------------------------

describe('model requests', () => {
  it('createRun posts the text in the body with the live step limit and parses the run', async () => {
    const c = client(() => respond(run));
    const res = await c.createRun('The quick brown fox');
    expect(res).toEqual(run.body);
    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls as [Call];
    expect(url).toBe(`${BASE}/api/v1/runs`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      text: 'The quick brown fox',
      max_new_tokens: limits.max_new_tokens,
    });
    expect(url).not.toContain('quick');
  });

  it('getAttention and getTokenEmbeddings parse their responses', async () => {
    const attention = fixture('attention');
    const embeddings = fixture('token-embeddings');
    const c = client((url) => respond(url.endsWith('/attention') ? attention : embeddings));
    expect(await c.getAttention(runIds, 1)).toEqual(attention.body);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ token_ids: runIds, layer: 1 });
    expect(await c.getTokenEmbeddings(runIds)).toEqual(embeddings.body);
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ token_ids: runIds });
  });

  it.each(errorNames)('%s becomes an ApiError with the same code and params', async (name) => {
    const f = fixture(name);
    const { code, params } = (f.body as { error: { code: ApiErrorCode; params?: object } }).error;
    const err = await expectCode(client(() => respond(f)).createRun('Hello'), code);
    expect(err.params).toEqual(params ?? {});
    expect(err.status).toBe(f.status);
  });

  it.each([
    ['createRun', (c: ReturnType<typeof client>) => c.createRun('Hello')],
    ['getAttention', (c: ReturnType<typeof client>) => c.getAttention(runIds, 1)],
    ['getTokenEmbeddings', (c: ReturnType<typeof client>) => c.getTokenEmbeddings(runIds)],
  ])('a fetch rejection on %s is a network error', async (_, call) => {
    await expectCode(
      call(
        client(() => {
          throw new TypeError('Failed to fetch');
        }),
      ),
      'network',
    );
  });

  it('a truncated body is invalid_response', async () => {
    const text = JSON.stringify(run.body);
    const c = client(() => new Response(text.slice(0, text.length / 2), { status: 200 }));
    await expectCode(c.createRun('Hello'), 'invalid_response');
  });

  it('a body of the wrong shape is invalid_response', async () => {
    const broken = fixture('run');
    (broken.body as { run: { tokens: unknown[] } }).run.tokens.pop();
    await expectCode(client(() => respond(broken)).createRun('Hello'), 'invalid_response');

    const attention = fixture('attention');
    (attention.body as { n_tokens: number }).n_tokens += 1;
    await expectCode(client(() => respond(attention)).getAttention(runIds, 1), 'invalid_response');
  });

  it('a run from another model revision is version_mismatch', async () => {
    await expectCode(
      client(() => respond(run), 'f'.repeat(40)).createRun('Hello'),
      'version_mismatch',
    );
  });
});

// --- timers: request ceiling and health polling (R13) ----------------------------------------

describe('with fake timers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A promise's outcome, observable without awaiting it. */
  function track<T>(p: Promise<T>) {
    const state: { done: boolean; value?: T; error?: unknown } = { done: false };
    p.then(
      (value) => Object.assign(state, { done: true, value }),
      (error: unknown) => Object.assign(state, { done: true, error }),
    );
    return state;
  }

  const hanging: Handler = (_url, init) =>
    new Promise((_, reject) =>
      init.signal?.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted.', 'AbortError')),
      ),
    );

  it('a model request is aborted after 60 s with timeout', async () => {
    const result = track(client(hanging).createRun('Hello'));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(result.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(result.done).toBe(true);
    expect((result.error as ApiError).code).toBe('timeout');
  });

  it('cancelling a request rejects with an AbortError, not an ApiError', async () => {
    const controller = new AbortController();
    const result = track(client(hanging).createRun('Hello', controller.signal));
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(result.done).toBe(true);
    expect(result.error).not.toBeInstanceOf(ApiError);
    expect((result.error as Error).name).toBe('AbortError');
  });

  const html = () =>
    new Response('<!doctype html><title>Starting</title>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  const unreachable = () => {
    throw new TypeError('Failed to fetch');
  };
  const isProbe = (init: RequestInit) => init.mode === 'no-cors';
  const healthCalls = () => calls.filter((c) => !isProbe(c.init));
  const probeCalls = () => calls.filter((c) => isProbe(c.init));

  it('a ready service resolves with its health', async () => {
    const onWaking = vi.fn();
    const result = track(client(() => respond(fixture('health'))).waitForService({ onWaking }));
    await vi.advanceTimersByTimeAsync(0);
    expect(result.value).toEqual(health);
    expect(onWaking).not.toHaveBeenCalled();
  });

  it('a non-JSON health reply is waking, then wake_timeout after the wait limit', async () => {
    const onWaking = vi.fn();
    const result = track(client(html).waitForService({ onWaking }));
    await vi.advanceTimersByTimeAsync(0);
    expect(onWaking).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(limits.wait_limit_s * 1000 - 3_000);
    expect(result.done).toBe(false);
    await vi.advanceTimersByTimeAsync(3_000 + 5_000);
    expect((result.error as ApiError).code).toBe('wake_timeout');
    expect(onWaking).toHaveBeenCalledTimes(1);
  });

  it('a 503 model_loading reply is waking', async () => {
    const onWaking = vi.fn();
    const result = track(
      client(() => respond(fixture('error-model_loading'))).waitForService({ onWaking }),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(result.done).toBe(false);
    expect(onWaking).toHaveBeenCalledTimes(1);
  });

  it('polls every 3 s', async () => {
    track(client(html).waitForService({}));
    await vi.advanceTimersByTimeAsync(0);
    expect(healthCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(healthCalls()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(healthCalls()).toHaveLength(3);
  });

  it('a health attempt that takes 5 s is waking', async () => {
    const onWaking = vi.fn();
    const result = track(client(hanging).waitForService({ onWaking }));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(onWaking).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onWaking).toHaveBeenCalledTimes(1);
    expect(result.done).toBe(false);
  });

  it('a CORS failure whose no-cors probe answers is waking, not network', async () => {
    const onWaking = vi.fn();
    const result = track(
      client((_url, init) => (isProbe(init) ? new Response('') : unreachable())).waitForService({
        onWaking,
      }),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(result.done).toBe(false);
    expect(onWaking).toHaveBeenCalledTimes(1);
    expect(probeCalls().length).toBeGreaterThanOrEqual(10);
  });

  it('two unreachable attempts in a row end with network within 10 s', async () => {
    const onWaking = vi.fn();
    const result = track(client(unreachable).waitForService({ onWaking }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(result.done).toBe(true);
    expect((result.error as ApiError).code).toBe('network');
    expect(onWaking).not.toHaveBeenCalled();
  });

  it('a waking attempt resets the unreachable count', async () => {
    const sequence = ['unreachable', 'waking', 'unreachable', 'ready'];
    let attempt = 0;
    const c = client((_url, init) => {
      const kind = sequence[isProbe(init) ? attempt - 1 : attempt++];
      if (kind === 'unreachable') return unreachable();
      if (isProbe(init)) return new Response('');
      return kind === 'waking' ? html() : respond(fixture('health'));
    });
    const result = track(c.waitForService({}));
    await vi.advanceTimersByTimeAsync(6_000);
    expect(result.done).toBe(false);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(result.value).toEqual(health);
  });

  it('the reachability probe carries no body and no credentials', async () => {
    track(client(unreachable).waitForService({}));
    await vi.advanceTimersByTimeAsync(0);
    const [probe] = probeCalls();
    expect(probe).toBeDefined();
    expect(probe!.url).toBe(`${BASE}/api/v1/health`);
    expect(probe!.init.body).toBeUndefined();
    expect(probe!.init.credentials).toBe('omit');
    expect(probe!.init.method ?? 'GET').toBe('GET');
  });

  it('a service on another model revision is version_mismatch', async () => {
    const result = track(
      client(() => respond(fixture('health')), 'f'.repeat(40)).waitForService({}),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect((result.error as ApiError).code).toBe('version_mismatch');
  });

  it('cancelling the wait stops polling', async () => {
    const controller = new AbortController();
    const result = track(client(html).waitForService({ signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(10_000);
    expect((result.error as Error).name).toBe('AbortError');
    expect(healthCalls()).toHaveLength(1);
  });
});
