// US6, quickstart Q7, FR-008/FR-009/FR-011/FR-013, SC-004: live mode against a mocked API fed
// by the contract fixtures. Runs in the `live` project, whose build has
// VITE_API_BASE_URL=http://api.test. The service is polled every 3 s while it wakes up.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { fill, fixture, json, mockApi, startingPage } from './live-api';

type Catalog = Record<string, string>;
const I18N = new URL('../../src/lib/i18n/', import.meta.url);
const en = JSON.parse(readFileSync(new URL('en.json', I18N), 'utf-8')) as Catalog;
const de = JSON.parse(readFileSync(new URL('de.json', I18N), 'utf-8')) as Catalog;
const limits = JSON.parse(
  readFileSync(new URL('../../../contracts/limits.json', import.meta.url), 'utf-8'),
) as {
  max_input_tokens: number;
  max_new_tokens: number;
  max_input_chars: number;
  wait_limit_s: number;
};
/** VITE_SPACE_URL of the `live` build (playwright.config.ts). */
const SPACE_URL = 'https://huggingface.co/spaces/test-user/test-space';

interface Token {
  id: number;
}
interface RunBody {
  model: unknown;
  run: { n_input: number; steps: number; stop_reason: string; tokens: Token[] };
}
const runFixture = fixture('run').body as RunBody;
const { n_input: N, steps: STEPS } = runFixture.run;
const runIds = runFixture.run.tokens.map((t) => t.id);

const EXAMPLES = new URL('../../public/data/examples/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', EXAMPLES), 'utf-8')) as {
  examples: { id: string; core: string }[];
};
const firstCore = JSON.parse(readFileSync(new URL(index.examples[0]!.core, EXAMPLES), 'utf-8')) as {
  example: { text: string };
  model: unknown;
  run: RunBody['run'];
};

test.use({ locale: 'en-US' });

const live = (page: Page) => page.locator('[data-live-mode]');
const status = (page: Page) => page.locator('[data-live-status]');
const liveError = (page: Page) => page.locator('[data-live-error]');
const runButton = (page: Page) => page.locator('[data-action="run"]');

async function enterLive(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('[data-mode-switch] input[value="live"]').check();
  await expect(page.locator('[data-app]')).toHaveAttribute('data-mode', 'live');
  await expect(live(page)).toBeVisible();
}

async function runText(page: Page, text: string): Promise<void> {
  await page.locator('[data-live-input]').fill(text);
  await runButton(page).click();
}

async function openView(page: Page, view: string): Promise<void> {
  await page.locator(`nav a[data-view="${view}"]`).click();
  await expect(page.locator(`section[data-view="${view}"]`)).toBeVisible();
}

function chipIds(page: Page, view: string) {
  return page
    .locator(`section[data-view="${view}"] [data-token-sequence] [data-token-id]`)
    .evaluateAll((els) => els.map((el) => Number((el as HTMLElement).dataset.tokenId)));
}

async function expectStep(page: Page, k: number): Promise<void> {
  await expect(page.locator('[data-step-counter]')).toHaveAttribute('data-step', String(k));
}

test('@live entering live mode shows the text field, hint, privacy note and limits', async ({
  page,
}) => {
  await mockApi(page);
  await enterLive(page);
  const input = page.locator('[data-live-input]');
  await expect(input).toBeVisible();
  await expect(input).toHaveAccessibleName(en['live.input_label']!);
  await expect(page.locator('[data-live-hint]')).toHaveText(en['live.hint']!);
  await expect(page.locator('[data-live-privacy]')).toHaveText(en['live.privacy']!);
  await expect(page.locator('[data-live-limits]')).toHaveText(
    fill(en['live.limits']!, { tokens: limits.max_input_tokens, steps: limits.max_new_tokens }),
  );
  await expect(runButton(page)).toBeDisabled(); // empty text
  await expect(page.locator('[data-example-picker]')).toHaveCount(0);
});

test('@live a run shows every view and steps like example mode', async ({ page }) => {
  const api = await mockApi(page);
  await enterLive(page);
  await expect(page.locator('[data-live-empty]')).toBeVisible();
  await runText(page, 'The quick brown fox');
  await expect(status(page)).toHaveAttribute('data-state', 'ready');
  await expectStep(page, 0);

  await openView(page, 'tokens');
  expect(await chipIds(page, 'tokens')).toEqual(runIds.slice(0, N));
  await openView(page, 'embeddings');
  await expect(page.locator('[data-embedding-row]')).toHaveCount(N);
  await openView(page, 'blocks');
  await expect(page.locator('section[data-view="blocks"] [data-block-schematic]')).toBeVisible();
  await openView(page, 'attention');
  await expect(page.locator('[data-heatmap-grid]')).toHaveAttribute('data-size', String(N));
  await openView(page, 'cost');
  await expect(page.locator('section[data-view="cost"] [data-cost-figure]').first()).toBeVisible();
  await openView(page, 'prediction');
  await expect(page.locator('section[data-view="prediction"] [data-candidates] > li')).toHaveCount(
    10,
  );

  const next = page.locator('[data-action="next"]');
  for (let k = 1; k <= STEPS; k++) {
    await next.click();
    await expectStep(page, k);
  }
  expect(await chipIds(page, 'prediction')).toEqual(runIds);
  await expect(next).toBeDisabled();
  await expect(page.locator('[data-end-message]')).toHaveAttribute(
    'data-stop-reason',
    runFixture.run.stop_reason,
  );
  await page.locator('[data-action="back"]').click();
  await expectStep(page, STEPS - 1);

  // Attention for another layer is fetched from the API when asked for.
  await openView(page, 'attention');
  const view = page.locator('section[data-view="attention"]');
  await view.locator('[data-action="next-layer"]').click();
  await expect(view.locator('[data-layer-label]')).toHaveAttribute('data-layer', '2');
  await expect(view.locator('[data-heatmap-grid]')).toHaveAttribute(
    'data-size',
    String(N + STEPS - 1),
  );
  const layers = api.requests
    .filter((r) => r.url().endsWith('/api/v1/attention'))
    .map((r) => (r.postDataJSON() as { layer: number }).layer);
  expect(layers).toEqual([1, 2]);
});

test('@live a text ending in "?" shows the chat tip without blocking the run', async ({ page }) => {
  await mockApi(page);
  await enterLive(page);
  await page.locator('[data-live-input]').fill('What is the capital of France?');
  await expect(page.locator('[data-chat-tip]')).toHaveText(en['live.chat_tip']!);
  await expect(runButton(page)).toBeEnabled();
  await runButton(page).click();
  await expect(status(page)).toHaveAttribute('data-state', 'ready');
});

test('@live non-English text gets the token note after the run', async ({ page }) => {
  await mockApi(page);
  await enterLive(page);
  await runText(page, 'Über den Wolken');
  await expect(status(page)).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('[data-non-english-note]')).toHaveText(en['live.non_english']!);
});

test('@live the character limit counts code points and disables Run', async ({ page }) => {
  await mockApi(page);
  await enterLive(page);
  const input = page.locator('[data-live-input]');
  await input.fill('😀'.repeat(limits.max_input_chars));
  await expect(page.locator('[data-char-count]')).toContainText(
    new Intl.NumberFormat('en-US').format(limits.max_input_chars),
  );
  await expect(runButton(page)).toBeEnabled();
  await input.fill('😀'.repeat(limits.max_input_chars + 1));
  await expect(runButton(page)).toBeDisabled();
  await input.fill('   ');
  await expect(runButton(page)).toBeDisabled();
});

test('@live a waking service shows the waking status with Cancel, then the result', async ({
  page,
}) => {
  await mockApi(page, {
    health: (route, _req, n) => (n < 2 ? startingPage(route) : json(route, fixture('health'))),
  });
  await enterLive(page);
  await runText(page, 'The quick brown fox');
  await expect(status(page)).toHaveAttribute('data-state', 'waking');
  await expect(page.locator('[data-action="cancel"]')).toBeVisible();
  await expect(status(page)).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
  await expect(liveError(page)).toHaveCount(0);
  await openView(page, 'tokens');
  expect(await chipIds(page, 'tokens')).toEqual(runIds.slice(0, N));
});

test('@live a starting page without CORS headers is waking, not unavailable', async ({ page }) => {
  // The CORS fetch fails, but the no-cors probe gets an (opaque) answer: the host is there.
  await mockApi(page, {
    health: (route, _req, n) =>
      n < 4 ? startingPage(route, false) : json(route, fixture('health')),
  });
  await enterLive(page);
  await runText(page, 'The quick brown fox');
  await expect(status(page)).toHaveAttribute('data-state', 'waking');
  await expect(status(page)).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
  await expect(liveError(page)).toHaveCount(0);
});

test('@live a service that does not wake in time links to its Space page', async ({ page }) => {
  // Fake timers: the wait limit passes without waiting for it.
  await page.clock.install();
  await mockApi(page, { health: (route) => startingPage(route) });
  await enterLive(page);
  await runText(page, 'The quick brown fox');
  await expect(status(page)).toHaveAttribute('data-state', 'waking');
  await page.clock.fastForward((limits.wait_limit_s + 1) * 1000);
  await expect(liveError(page)).toHaveAttribute('data-code', 'wake_timeout');
  const link = liveError(page).locator('a[data-space-link]');
  await expect(link).toHaveAttribute('href', SPACE_URL);
  await expect(link).toHaveText(en['live.space_link']!);
  await expect(liveError(page).locator('[data-action="back-to-examples"]')).toBeVisible();
});

test('@live Cancel stops waiting and returns to idle', async ({ page }) => {
  const api = await mockApi(page, { health: (route) => startingPage(route) });
  await enterLive(page);
  await runText(page, 'The quick brown fox');
  await expect(status(page)).toHaveAttribute('data-state', 'waking');
  await page.locator('[data-action="cancel"]').click();
  await expect(status(page)).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('[data-action="cancel"]')).toHaveCount(0);
  await expect(runButton(page)).toBeEnabled();
  const polls = api.count('health');
  await page.waitForTimeout(4_000);
  expect(api.count('health')).toBe(polls);
  expect(api.count('runs')).toBe(0);
});

test('@live an unreachable service shows a translated message within 10 s', async ({ page }) => {
  await page.route('http://api.test/**', (route) => route.abort('connectionrefused'));
  await enterLive(page);
  // Entering live mode already checks the service; wait for that check to fail first.
  await expect(liveError(page)).toHaveAttribute('data-code', 'network', { timeout: 10_000 });

  await page.locator('[data-live-input]').fill('The quick brown fox');
  const start = Date.now();
  await runButton(page).click();
  await expect(liveError(page)).toHaveCount(0);
  await expect(liveError(page)).toHaveAttribute('data-code', 'network', { timeout: 10_000 });
  expect(Date.now() - start).toBeLessThan(10_000);
  await expect(liveError(page)).toContainText(en['error.network']!);

  await page.locator('[data-action="back-to-examples"]').click();
  await expect(page.locator('[data-app]')).toHaveAttribute('data-mode', 'example');
  await expect(page.locator('[data-example-picker]')).toBeVisible();
  await openView(page, 'tokens');
  await expect(
    page.locator('section[data-view="tokens"] [data-token-sequence] [data-token-id]').first(),
  ).toBeVisible();
  await openView(page, 'prediction');
  await expect(page.locator('section[data-view="prediction"] [data-candidates] > li')).toHaveCount(
    10,
  );
});

for (const code of ['rate_limited', 'busy'] as const) {
  test(`@live ${code} shows a translated message with the retry time`, async ({ page }) => {
    const f = fixture(`error-${code}`);
    await mockApi(page, { runs: (route) => json(route, f) });
    await enterLive(page);
    await runText(page, 'The quick brown fox');
    const params = (f.body as { error: { params: Record<string, number> } }).error.params;
    await expect(liveError(page)).toHaveAttribute('data-code', code);
    await expect(liveError(page)).toContainText(fill(en[`error.${code}`]!, params));
    await expect(liveError(page)).toContainText(String(params.retry_after_s));
  });
}

test('@live input_too_long_tokens shows the limit and the actual count', async ({ page }) => {
  const f = fixture('error-input_too_long_tokens');
  await mockApi(page, { runs: (route) => json(route, f) });
  await enterLive(page);
  await runText(page, 'a a a a');
  const params = (f.body as { error: { params: Record<string, number> } }).error.params;
  await expect(liveError(page)).toHaveAttribute('data-code', 'input_too_long_tokens');
  await expect(liveError(page)).toContainText(fill(en['error.input_too_long_tokens']!, params));
});

test('@live switching language during a request shows the result in the new language', async ({
  page,
}) => {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const api = await mockApi(page, {
    runs: async (route) => {
      await released;
      await json(route, fixture('run'));
    },
  });
  await enterLive(page);
  await runText(page, 'The quick brown fox');
  await expect(status(page)).toHaveAttribute('data-state', 'running');
  await expect.poll(() => api.count('runs')).toBe(1);

  await page.locator('[data-language-switch] input[value="de"]').check();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(status(page)).toContainText(de['live.status.running']!);
  release();

  await expect(status(page)).toHaveAttribute('data-state', 'ready');
  await expect(status(page)).toContainText(de['live.status.ready']!);
  await expect(page.locator('[data-live-hint]')).toHaveText(de['live.hint']!);
  await expect(page.locator('[data-action="next"]')).toContainText(de['generation.next']!);
});

test('@live an error that arrives after a language switch is in the new language', async ({
  page,
}) => {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await mockApi(page, {
    runs: async (route) => {
      await released;
      await json(route, fixture('error-internal'));
    },
  });
  await enterLive(page);
  await runText(page, 'The quick brown fox');
  await expect(status(page)).toHaveAttribute('data-state', 'running');
  await page.locator('[data-language-switch] input[value="de"]').check();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  release();
  await expect(liveError(page)).toContainText(de['error.internal']!);
  await expect(page.locator('[data-action="back-to-examples"]')).toHaveText(
    de['live.back_to_examples']!,
  );
});

test('@live "Continue in live mode" re-runs the example text in live mode', async ({ page }) => {
  const api = await mockApi(page, {
    runs: (route) =>
      json(route, { status: 200, body: { model: firstCore.model, run: firstCore.run } }),
  });
  await page.goto('/');
  await expect(page.locator('[data-app]')).toHaveAttribute('data-mode', 'example');
  const next = page.locator('[data-action="next"]');
  for (let k = 1; k <= firstCore.run.steps; k++) {
    await next.click();
    await expectStep(page, k);
  }
  const offer = page.locator('[data-live-offer]');
  await expect(offer).toBeVisible();
  expect(api.count('runs')).toBe(0);

  await offer.locator('[data-action="continue-live"]').click();
  await expect(page.locator('[data-app]')).toHaveAttribute('data-mode', 'live');
  await expect(page.locator('[data-live-input]')).toHaveValue(firstCore.example.text);
  await expect(status(page)).toHaveAttribute('data-state', 'ready');
  const post = api.requests.find((r) => r.url().endsWith('/api/v1/runs'));
  expect(post?.postDataJSON()).toEqual({
    text: firstCore.example.text,
    max_new_tokens: limits.max_new_tokens,
  });
  // The visitor stays where they were.
  await expectStep(page, firstCore.run.steps);
});
