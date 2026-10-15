// Live-mode client for the inference API (contracts/inference-api.openapi.yaml, research R12,
// R13). Every request has a time limit; a response is read in full, parsed and checked before
// it is returned, so a truncated or malformed answer never reaches the views. Text is sent only
// in POST bodies, and nothing here logs.
import type { components } from '../../generated/api-types';
import { prefixPackedLength } from '../data/binary';
import { loadIndex } from '../data/exampleSource';
import { assertRunCore } from '../data/runData';
import { limits } from '../limits';
import { modelConfig } from '../model/config';

type Schemas = components['schemas'];
export type Health = Schemas['Health'];
export type RunResponse = Schemas['RunResponse'];
export type AttentionResponse = Schemas['AttentionResponse'];
export type TokenEmbeddingsResponse = Schemas['TokenEmbeddingsResponse'];
export type ServerErrorCode = Schemas['ErrorCode'];
/** Raised by the client itself, never sent by the service (data-model.md "ApiError"). */
export type ClientErrorCode =
  'timeout' | 'network' | 'wake_timeout' | 'version_mismatch' | 'invalid_response';
export type ApiErrorCode = ServerErrorCode | ClientErrorCode;
export type ErrorParams = Record<string, number | string>;

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly params: ErrorParams = {},
    /** HTTP status, when the service answered. */
    readonly status?: number,
  ) {
    super(`API error: ${code}`);
    this.name = 'ApiError';
  }
}

export const SERVER_ERROR_CODES: readonly ServerErrorCode[] = [
  'empty_input',
  'input_too_long_chars',
  'input_too_long_tokens',
  'invalid_request',
  'rate_limited',
  'busy',
  'model_loading',
  'internal',
];

export const CLIENT_ERROR_CODES: readonly ClientErrorCode[] = [
  'timeout',
  'network',
  'wake_timeout',
  'version_mismatch',
  'invalid_response',
];

/** Each health attempt (research R13). */
const HEALTH_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 3_000;
/** This many unreachable attempts in a row end the wait at once with `network`. */
const UNREACHABLE_IN_A_ROW = 2;
/** The wait limit also caps every model request, wake-up included. */
const REQUEST_TIMEOUT_MS = limits.wait_limit_s * 1000;

export function isAbortError(e: unknown): boolean {
  return (e as { name?: unknown } | null)?.name === 'AbortError';
}

function abortError(): DOMException {
  return new DOMException('The request was cancelled.', 'AbortError');
}

/** `outer` (the caller's cancel) combined with a time limit we can tell apart from it. */
function deadline(outer: AbortSignal | undefined, ms: number) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  const cancel = () => controller.abort();
  if (outer?.aborted) cancel();
  else outer?.addEventListener('abort', cancel, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    done() {
      clearTimeout(timer);
      outer?.removeEventListener('abort', cancel);
    },
  };
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// --- response guards (hand-written: no schema validator ships to the browser) ----------------

function fail(): never {
  throw new ApiError('invalid_response');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const isPositiveInt = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0;

function checkModelRef(v: unknown): void {
  if (!isRecord(v) || typeof v.id !== 'string') fail();
  if (typeof v.revision !== 'string' || !/^[0-9a-f]{40}$/.test(v.revision)) fail();
}

function assertHealth(v: unknown): asserts v is Health {
  if (!isRecord(v) || v.status !== 'ok' || typeof v.api_version !== 'string') fail();
  checkModelRef(v.model);
  const l = v.limits;
  if (!isRecord(l)) fail();
  for (const key of ['max_input_tokens', 'max_new_tokens', 'max_input_chars', 'wait_limit_s']) {
    if (!isPositiveInt(l[key])) fail();
  }
}

function assertRunResponse(v: unknown): asserts v is RunResponse {
  if (!isRecord(v)) fail();
  checkModelRef(v.model);
  try {
    assertRunCore(v.run, 'live');
  } catch {
    fail();
  }
}

function checkEncoded(v: unknown, dtype: 'float32' | 'uint16', shape: number[]): void {
  if (!isRecord(v) || v.dtype !== dtype || typeof v.data !== 'string') fail();
  if (!Array.isArray(v.shape) || v.shape.join() !== shape.join()) fail();
  if (v.scale !== undefined && !(typeof v.scale === 'number' && v.scale > 0)) fail();
}

function attentionGuard(ids: number[], layer: number) {
  return (v: unknown): asserts v is AttentionResponse => {
    if (!isRecord(v) || v.layer !== layer || v.n_tokens !== ids.length) fail();
    checkEncoded(v.weights, 'uint16', [modelConfig.nHead, prefixPackedLength(ids.length)]);
  };
}

function embeddingsGuard(ids: number[]) {
  const unique = [...new Set(ids)];
  return (v: unknown): asserts v is TokenEmbeddingsResponse => {
    if (!isRecord(v) || !Array.isArray(v.unique_ids)) fail();
    if (v.unique_ids.join() !== unique.join()) fail();
    checkEncoded(v.embeddings, 'float32', [unique.length, modelConfig.nEmbd]);
  };
}

function serverError(status: number, text: string): ApiError {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new ApiError('invalid_response', {}, status);
  }
  const error = isRecord(body) ? body.error : undefined;
  if (!isRecord(error) || !SERVER_ERROR_CODES.includes(error.code as ServerErrorCode)) {
    return new ApiError('invalid_response', {}, status);
  }
  const params = isRecord(error.params) ? (error.params as ErrorParams) : {};
  return new ApiError(error.code as ServerErrorCode, params, status);
}

// --- client ----------------------------------------------------------------------------------

export type HealthAttempt = { kind: 'ready'; health: Health } | { kind: 'waking' | 'unreachable' };

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  /** Model revision of the shipped examples; a service on another revision is refused. */
  expectedRevision: () => Promise<string>;
}

export interface WaitOptions {
  signal?: AbortSignal;
  /** Called once, on the first attempt that finds the service waking up. */
  onWaking?: () => void;
}

export function createApiClient({
  baseUrl,
  fetch: fetchFn = (...args) => fetch(...args),
  expectedRevision,
}: ApiClientOptions) {
  const url = (path: string) => `${baseUrl.replace(/\/+$/, '')}/api/v1/${path}`;
  const healthUrl = url('health');

  /**
   * Whether the host answered at all. The service's start-up page may lack CORS headers, which
   * makes a CORS fetch fail like an unreachable host; an opaque `no-cors` answer tells them
   * apart. It carries no body or credentials, and its response is never read.
   */
  async function probeReachable(target: string, signal?: AbortSignal): Promise<boolean> {
    const d = deadline(signal, HEALTH_TIMEOUT_MS);
    try {
      await fetchFn(target, {
        mode: 'no-cors',
        cache: 'no-store',
        credentials: 'omit',
        signal: d.signal,
      });
      return true;
    } catch {
      if (signal?.aborted) throw abortError();
      return false;
    } finally {
      d.done();
    }
  }

  /** One health attempt, classified per the R13 table. */
  async function getHealth(signal?: AbortSignal): Promise<HealthAttempt> {
    const d = deadline(signal, HEALTH_TIMEOUT_MS);
    let res: Response;
    let text: string;
    try {
      res = await fetchFn(healthUrl, {
        cache: 'no-store',
        credentials: 'omit',
        signal: d.signal,
      });
      text = await res.text();
    } catch {
      if (signal?.aborted) throw abortError();
      if (d.timedOut()) return { kind: 'waking' };
      return { kind: (await probeReachable(healthUrl, signal)) ? 'waking' : 'unreachable' };
    } finally {
      d.done();
    }
    if (res.status !== 200) return { kind: 'waking' };
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { kind: 'waking' }; // e.g. the host's "starting" HTML page
    }
    assertHealth(body);
    return { kind: 'ready', health: body };
  }

  /**
   * Poll /health every 3 s until the service is ready. Ends with `network` after two
   * unreachable attempts in a row, `wake_timeout` after the wait limit, or `version_mismatch`
   * if the service runs another model revision than the examples.
   */
  async function waitForService({ signal, onWaking }: WaitOptions = {}): Promise<Health> {
    const start = Date.now();
    const limitMs = limits.wait_limit_s * 1000;
    let unreachable = 0;
    let notified = false;
    for (;;) {
      const attempt = await getHealth(signal);
      if (attempt.kind === 'ready') {
        if (attempt.health.model.revision !== (await expectedRevision())) {
          throw new ApiError('version_mismatch');
        }
        return attempt.health;
      }
      if (attempt.kind === 'waking') {
        unreachable = 0;
        if (!notified) {
          notified = true;
          onWaking?.();
        }
      } else if (++unreachable >= UNREACHABLE_IN_A_ROW) {
        throw new ApiError('network');
      }
      const left = limitMs - (Date.now() - start);
      if (left <= 0) throw new ApiError('wake_timeout');
      await sleep(Math.min(POLL_INTERVAL_MS, left), signal);
    }
  }

  async function post<T>(
    path: string,
    body: object,
    guard: (v: unknown) => asserts v is T,
    signal?: AbortSignal,
  ): Promise<T> {
    const d = deadline(signal, REQUEST_TIMEOUT_MS);
    let res: Response;
    let text: string;
    try {
      res = await fetchFn(url(path), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
        credentials: 'omit',
        signal: d.signal,
      });
      text = await res.text();
    } catch {
      if (signal?.aborted) throw abortError();
      throw new ApiError(d.timedOut() ? 'timeout' : 'network');
    } finally {
      d.done();
    }
    if (!res.ok) throw serverError(res.status, text);
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      fail();
    }
    guard(data);
    return data;
  }

  /** Always asks for the live step limit; the visitor then steps through it locally. */
  async function createRun(text: string, signal?: AbortSignal): Promise<RunResponse> {
    const res = await post(
      'runs',
      { text, max_new_tokens: limits.max_new_tokens },
      assertRunResponse,
      signal,
    );
    if (res.model.revision !== (await expectedRevision())) throw new ApiError('version_mismatch');
    return res;
  }

  function getAttention(ids: number[], layer: number, signal?: AbortSignal) {
    return post('attention', { token_ids: ids, layer }, attentionGuard(ids, layer), signal);
  }

  function getTokenEmbeddings(ids: number[], signal?: AbortSignal) {
    return post('token-embeddings', { token_ids: ids }, embeddingsGuard(ids), signal);
  }

  return { getHealth, probeReachable, waitForService, createRun, getAttention, getTokenEmbeddings };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** The API this build talks to; empty means live mode is not offered (Principle V). */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '';

/**
 * The service's Space page on huggingface.co (e.g. https://huggingface.co/spaces/<user>/<space>),
 * linked when the service does not wake in time: a visit there can wake a sleeping Space (R13).
 * Empty hides the link.
 */
export const SPACE_URL: string = import.meta.env.VITE_SPACE_URL ?? '';

let defaultClient: ApiClient | null = null;

export function apiClient(): ApiClient {
  defaultClient ??= createApiClient({
    baseUrl: API_BASE_URL,
    expectedRevision: async () => (await loadIndex()).model.revision,
  });
  return defaultClient;
}
