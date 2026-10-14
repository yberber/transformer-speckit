// FR-010, SC-002, quickstart Q6/Q7 in the browser: live mode against the real backend gives the
// same tokens as example mode, probabilities within 1e-4, and loads attention and embeddings
// through the API. Runs only with `npm run test:e2e:fullstack` (project `fullstack`), which
// starts the backend on :7860 with ALLOWED_ORIGINS set to this site's origin.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

interface Core {
  example: { id: string; length: string; text: string };
  run: {
    n_input: number;
    steps: number;
    stop_reason: string;
    tokens: { id: number }[];
    predictions: { candidates: { id: number; prob: number }[] }[];
  };
}

const EXAMPLES = new URL('../../public/data/examples/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', EXAMPLES), 'utf-8')) as {
  examples: { id: string; length: string; core: string }[];
};
const read = (length: string): Core => {
  const entry = index.examples.find((e) => e.length === length)!;
  return JSON.parse(readFileSync(new URL(entry.core, EXAMPLES), 'utf-8')) as Core;
};
const PROB_TOL = 1e-4;

test.use({ locale: 'en-US' });
test.setTimeout(120_000);

async function openView(page: Page, view: string): Promise<void> {
  await page.locator(`nav a[data-view="${view}"]`).click();
  await expect(page.locator(`section[data-view="${view}"]`)).toBeVisible();
}

function chipIds(page: Page, view: string) {
  return page
    .locator(`section[data-view="${view}"] [data-token-sequence] [data-token-id]`)
    .evaluateAll((els) => els.map((el) => Number((el as HTMLElement).dataset.tokenId)));
}

async function expectPrediction(page: Page, want: Core['run']['predictions'][number]) {
  const view = page.locator('section[data-view="prediction"]');
  const ids = await view
    .locator('[data-candidates] > li')
    .evaluateAll((els) => els.map((el) => Number((el as HTMLElement).dataset.tokenId)));
  expect(ids).toEqual(want.candidates.map((c) => c.id));
  const probs = await view
    .locator('[data-candidate-table] tbody [data-col="prob"]')
    .allTextContents();
  expect(probs).toHaveLength(want.candidates.length);
  probs.forEach((text, j) => {
    const got = Number(text.replaceAll(',', ''));
    expect(Math.abs(got - want.candidates[j]!.prob), `candidate ${j}`).toBeLessThanOrEqual(
      PROB_TOL,
    );
  });
}

for (const length of ['short', 'long']) {
  const core = read(length);
  const { n_input: n, steps, tokens, predictions } = core.run;
  const ids = tokens.map((t) => t.id);

  test(`@fullstack ${core.example.id}: live mode matches example mode`, async ({ page }) => {
    const apiCalls: string[] = [];
    page.on('request', (r) => {
      const path = new URL(r.url()).pathname;
      if (path.startsWith('/api/v1/') && r.method() !== 'OPTIONS') apiCalls.push(path);
    });

    await page.goto('/');
    await page.locator('[data-mode-switch] input[value="live"]').check();
    await page.locator('[data-live-input]').fill(core.example.text);
    await page.locator('[data-action="run"]').click();
    await expect(page.locator('[data-live-status]')).toHaveAttribute('data-state', 'ready', {
      timeout: 90_000,
    });

    await openView(page, 'tokens');
    expect(await chipIds(page, 'tokens')).toEqual(ids.slice(0, n));

    await openView(page, 'prediction');
    await page.locator('section[data-view="prediction"] [data-show-details]').click();
    await expectPrediction(page, predictions[0]!);

    const next = page.locator('[data-action="next"]');
    for (let k = 1; k <= steps; k++) {
      await next.click();
      await expect(page.locator('[data-step-counter]')).toHaveAttribute('data-step', String(k));
    }
    expect(await chipIds(page, 'prediction')).toEqual(ids);
    await expectPrediction(page, predictions[steps]!);
    if (core.run.stop_reason === 'eos') await expect(next).toBeDisabled();

    await openView(page, 'attention');
    await expect(page.locator('[data-heatmap-grid]')).toHaveAttribute(
      'data-size',
      String(n + steps),
    );
    await openView(page, 'embeddings');
    await expect(page.locator('[data-embedding-row]')).toHaveCount(n + steps);

    expect(apiCalls).toContain('/api/v1/runs');
    expect(apiCalls).toContain('/api/v1/attention');
    expect(apiCalls).toContain('/api/v1/token-embeddings');
  });
}
