// US1, quickstart Q1, FR-004: example mode works with no server. Every request that leaves the
// preview origin is aborted, and no request may go to an API path. Values on screen are compared
// against the committed core.json of each example.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

interface Token {
  id: number;
  bytes: number[];
}
interface Candidate extends Token {
  prob: number;
}
interface Core {
  example: { id: string; length: 'short' | 'medium' | 'long'; text: string };
  run: {
    n_input: number;
    steps: number;
    stop_reason: string;
    tokens: Token[];
    predictions: { candidates: Candidate[] }[];
  };
}

const EXAMPLES = new URL('../../public/data/examples/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', EXAMPLES), 'utf-8')) as {
  examples: { id: string; length: string; core: string }[];
};
const cores: Core[] = index.examples.map(
  (e) => JSON.parse(readFileSync(new URL(e.core, EXAMPLES), 'utf-8')) as Core,
);

/** Probabilities in the details table: 7 significant digits in the UI locale (en). */
const sig7 = new Intl.NumberFormat('en-US', {
  minimumSignificantDigits: 7,
  maximumSignificantDigits: 7,
});

test.use({ locale: 'en-US' });

let apiRequests: string[];

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  apiRequests = [];
  page.on('request', (req) => {
    if (new URL(req.url()).pathname.includes('/api/')) apiRequests.push(req.url());
  });
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
});

test.afterEach(() => {
  expect(apiRequests, 'example mode must never call the API').toEqual([]);
});

async function openView(page: Page, view: string): Promise<void> {
  await page.locator(`nav a[data-view="${view}"]`).click();
  await expect(page.locator(`section[data-view="${view}"]`)).toBeVisible();
}

function chipIds(page: Page, view: string) {
  return page
    .locator(`section[data-view="${view}"] [data-token-sequence] [data-token-id]`)
    .evaluateAll((els) => els.map((el) => Number((el as HTMLElement).dataset.tokenId)));
}

function candidateIds(page: Page) {
  return page
    .locator('section[data-view="prediction"] [data-candidates] > li')
    .evaluateAll((els) => els.map((el) => Number((el as HTMLElement).dataset.tokenId)));
}

const ids = (tokens: Token[]) => tokens.map((t) => t.id);

async function expectStep(page: Page, k: number): Promise<void> {
  await expect(page.locator('[data-step-counter]')).toHaveAttribute('data-step', String(k));
}

test('@example-mode landing state: example mode, first example, text-completion note', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('[data-app]')).toHaveAttribute('data-mode', 'example');
  await expect(page.locator('[data-intro-note]')).toBeVisible();
  await expect(page.locator('[data-intro-note]')).toContainText('GPT-2');

  const picker = page.locator('[data-example-picker]');
  await expect(picker.locator(`input[value="${index.examples[0]!.id}"]`)).toBeChecked();
  await expect(picker.locator('input[type="radio"]')).toHaveCount(6);
  for (const [length, label] of [
    ['short', 'Short'],
    ['medium', 'Medium'],
    ['long', 'Long'],
  ] as const) {
    const group = picker.locator(`[data-example-group="${length}"]`);
    await expect(group).toContainText(label);
    await expect(group.locator('input[type="radio"]')).toHaveCount(2);
  }
  for (const core of cores) {
    await expect(picker.locator(`[data-example-option="${core.example.id}"]`)).toContainText(
      String(core.run.n_input),
    );
  }

  // No API configured: live mode is hidden.
  await expect(page.locator('[data-mode-switch]')).toHaveCount(0);
});

for (const core of cores) {
  const { id } = core.example;
  const { n_input: n, steps, tokens, predictions } = core.run;

  test(`@example-mode ${id}: tokens, prediction and stepping match core.json`, async ({ page }) => {
    await page.goto('/');
    await page.locator(`[data-example-picker] input[value="${id}"]`).check();
    await expectStep(page, 0);

    // Tokens view: one chip per input token; details show IDs and exact text with ␣.
    await openView(page, 'tokens');
    await expect(
      page.locator('section[data-view="tokens"] [data-token-sequence] [data-token-id]'),
    ).toHaveCount(n);
    expect(await chipIds(page, 'tokens')).toEqual(ids(tokens.slice(0, n)));

    await page.locator('section[data-view="tokens"] [data-show-details]').click();
    const rows = page.locator('section[data-view="tokens"] [data-token-table] tbody tr');
    await expect(rows).toHaveCount(n);
    for (let i = 0; i < n; i++) {
      await expect(rows.nth(i).locator('[data-col="id"]')).toHaveText(String(tokens[i]!.id));
    }
    const spaced = tokens.slice(0, n).findIndex((t) => t.bytes[0] === 0x20);
    expect(spaced, 'every example has a token with a leading space').toBeGreaterThanOrEqual(0);
    await expect(rows.nth(spaced).locator('[data-col="text"]')).toContainText('␣');

    // Prediction view: ten candidates in order, the first marked as the greedy choice.
    await openView(page, 'prediction');
    const items = page.locator('section[data-view="prediction"] [data-candidates] > li');
    await expect(items).toHaveCount(10);
    expect(await candidateIds(page)).toEqual(ids(predictions[0]!.candidates));
    await expect(items.first()).toHaveAttribute('data-greedy', 'true');
    await expect(items.first().locator('[data-greedy-badge]')).toBeVisible();
    await expect(items.nth(1).locator('[data-greedy-badge]')).toHaveCount(0);

    await page.locator('section[data-view="prediction"] [data-show-details]').click();
    const probCells = page.locator(
      'section[data-view="prediction"] [data-candidate-table] tbody [data-col="prob"]',
    );
    await expect(probCells).toHaveCount(10);
    for (let j = 0; j < 10; j++) {
      await expect(probCells.nth(j)).toHaveText(sig7.format(predictions[0]!.candidates[j]!.prob));
    }

    // Next token ×3, then Back to exactly step 2, then forward to the same token again.
    const next = page.locator('[data-action="next"]');
    const back = page.locator('[data-action="back"]');
    for (let k = 1; k <= 3; k++) {
      await next.click();
      await expectStep(page, k);
    }
    expect(await chipIds(page, 'prediction')).toEqual(ids(tokens.slice(0, n + 3)));
    expect(await candidateIds(page)).toEqual(ids(predictions[3]!.candidates));

    await back.click();
    await expectStep(page, 2);
    expect(await chipIds(page, 'prediction')).toEqual(ids(tokens.slice(0, n + 2)));
    expect(await candidateIds(page)).toEqual(ids(predictions[2]!.candidates));

    await next.click();
    await expectStep(page, 3);
    expect(await chipIds(page, 'prediction')).toEqual(ids(tokens.slice(0, n + 3)));

    // The other views follow the step too.
    await openView(page, 'tokens');
    expect(await chipIds(page, 'tokens')).toEqual(ids(tokens.slice(0, n + 3)));
    await openView(page, 'prediction');

    // Up to the last precomputed step: Next is disabled, the end message shows, no live offer.
    for (let k = 4; k <= steps; k++) {
      await next.click();
      await expectStep(page, k);
    }
    await expect(next).toBeDisabled();
    await expect(page.locator('[data-end-message]')).toBeVisible();
    await expect(page.locator('[data-end-message]')).toHaveAttribute(
      'data-stop-reason',
      core.run.stop_reason,
    );
    await expect(page.locator('[data-live-offer]')).toHaveCount(0);
    expect(await chipIds(page, 'prediction')).toEqual(ids(tokens));
    expect(await candidateIds(page)).toEqual(ids(predictions[steps]!.candidates));
  });
}
