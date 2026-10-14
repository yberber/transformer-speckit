// Live mode session (data-model.md "Run", state transitions):
//   idle → validating (char cap) → waking? → running → ready | error(code)
//   ready → idle on new text; any state → idle on cancel; error → example mode on "back to
//   examples" (done by the caller, which then calls reset()).
// The live text lives only here, in memory. This module never touches the URL or browser
// storage, and imports nothing that does (Principle IV, FR-012, FR-034).
import {
  ApiError,
  apiClient,
  isAbortError,
  type ApiClient,
  type ApiErrorCode,
} from '../api/client';
import { createLiveRun, type LiveRun } from '../data/liveSource';
import { limits } from '../limits';

export type LiveState = 'idle' | 'validating' | 'waking' | 'running' | 'ready' | 'error';

export interface LiveError {
  code: ApiErrorCode;
  params: Record<string, number | string>;
}

type Client = Pick<
  ApiClient,
  'waitForService' | 'createRun' | 'getAttention' | 'getTokenEmbeddings'
>;

/** Unicode code points, as the service counts them. */
export function charCount(text: string): number {
  return [...text].length;
}

export class LiveSession {
  state: LiveState = $state('idle');
  text = $state('');
  run: LiveRun | null = $state.raw(null);
  error: LiveError | null = $state.raw(null);
  /** When the current wait first found the service waking up (ms since epoch). */
  wakingSince: number | null = $state(null);
  /** The service runs another model than the examples: live mode stays off. */
  disabled = $state(false);

  private controller: AbortController | null = null;

  constructor(private readonly client: () => Client) {}

  /** Entering live mode: check (and wake) the service before any text is sent. */
  async enter(): Promise<void> {
    if (this.disabled || this.controller) return;
    await this.operation(async (signal, current) => {
      await this.waitForService(signal, current);
      if (current()) this.state = 'idle';
    });
  }

  setText(text: string): void {
    this.text = text;
    if (this.state === 'ready' || this.state === 'error') {
      this.state = 'idle';
      this.run = null;
      this.error = null;
    }
  }

  /** Run `text` (also replaces the text field). Resolves when this run ends either way. */
  async runText(text: string): Promise<void> {
    if (this.disabled) return;
    this.abort();
    this.text = text;
    this.run = null;
    this.error = null;
    this.state = 'validating';
    if (text.trim() === '') return this.fail({ code: 'empty_input', params: {} });
    const chars = charCount(text);
    if (chars > limits.max_input_chars) {
      return this.fail({
        code: 'input_too_long_chars',
        params: { limit: limits.max_input_chars, actual: chars },
      });
    }
    await this.operation(async (signal, current) => {
      await this.waitForService(signal, current);
      if (!current()) return;
      this.state = 'running';
      const client = this.client();
      const response = await client.createRun(text, signal);
      if (!current()) return;
      this.run = createLiveRun(response, client);
      this.state = 'ready';
    });
  }

  /** Stop waiting or running; the text stays. */
  cancel(): void {
    this.abort();
    this.wakingSince = null;
    this.state = 'idle';
  }

  /** Leaving live mode: the run and the text are discarded. */
  reset(): void {
    this.cancel();
    this.text = '';
    this.run = null;
    this.error = null;
  }

  private abort(): void {
    this.controller?.abort();
    this.controller = null;
  }

  private fail(error: LiveError): void {
    this.wakingSince = null;
    this.error = error;
    this.state = 'error';
    if (error.code === 'version_mismatch') this.disabled = true;
  }

  private async waitForService(signal: AbortSignal, current: () => boolean): Promise<void> {
    await this.client().waitForService({
      signal,
      onWaking: () => {
        if (!current()) return;
        this.state = 'waking';
        this.wakingSince = Date.now();
      },
    });
    if (current()) this.wakingSince = null;
  }

  /** Runs one cancellable step; a newer operation or cancel() makes its results stale. */
  private async operation(
    body: (signal: AbortSignal, current: () => boolean) => Promise<void>,
  ): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    const current = () => this.controller === controller;
    this.state = 'validating';
    try {
      await body(controller.signal, current);
    } catch (e) {
      if (!current() || isAbortError(e)) return;
      this.fail(
        e instanceof ApiError
          ? { code: e.code, params: e.params }
          : { code: 'invalid_response', params: {} },
      );
    } finally {
      if (current()) this.controller = null;
    }
  }
}

export const liveSession = new LiveSession(apiClient);
