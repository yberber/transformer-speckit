// Principle IV, FR-012, FR-034, quickstart Q9: text typed in live mode leaves the page only in
// the body of the POST to /api/v1/runs. It never reaches the URL, another request, browser
// storage or cookies. Runs in the `live` project against the mocked API.
import { expect, test, type Request } from '@playwright/test';
import { mockApi } from './live-api';

test('@privacy live text is sent only in the /runs request body', async ({ page }) => {
  const canary = `canary${crypto.randomUUID().replaceAll('-', '')}`;
  const requests: Request[] = [];
  page.on('request', (r) => requests.push(r));
  await mockApi(page);

  await page.goto('/');
  await page.locator('[data-mode-switch] input[value="live"]').check();
  await page.locator('[data-live-input]').fill(`My secret note: ${canary}`);
  await page.locator('[data-action="run"]').click();
  await expect(page.locator('[data-live-status]')).toHaveAttribute('data-state', 'ready');

  // Visit the views that fetch more data for the run, so their requests are checked too.
  for (const view of ['embeddings', 'attention', 'prediction']) {
    await page.locator(`nav a[data-view="${view}"]`).click();
    await expect(page.locator(`section[data-view="${view}"]`)).toBeVisible();
  }
  await expect(page.locator('section[data-view="prediction"] [data-candidates] > li')).toHaveCount(
    10,
  );
  await page.locator('[data-action="next"]').click();

  expect(page.url()).not.toContain(canary);
  for (const r of requests) expect(r.url(), r.url()).not.toContain(canary);

  const carriers = requests.filter((r) => (r.postData() ?? '').includes(canary));
  expect(carriers.map((r) => `${r.method()} ${new URL(r.url()).pathname}`)).toEqual([
    'POST /api/v1/runs',
  ]);
  for (const r of requests) {
    const headers = await r.allHeaders();
    for (const [name, value] of Object.entries(headers)) {
      expect(`${name}: ${value}`, r.url()).not.toContain(canary);
    }
  }

  const stored = await page.evaluate(async () => {
    const dump = (s: Storage) =>
      Array.from({ length: s.length }, (_, i) => {
        const key = s.key(i)!;
        return `${key}=${s.getItem(key)}`;
      });
    const databases = (await indexedDB.databases()).map((d) => d.name ?? '');
    return {
      local: dump(localStorage),
      session: dump(sessionStorage),
      databases,
      cookie: document.cookie,
      history: JSON.stringify(history.state),
    };
  });
  expect(stored.local.join('\n')).not.toContain(canary);
  expect(stored.session.join('\n')).not.toContain(canary);
  expect(stored.databases.join('\n')).not.toContain(canary);
  expect(stored.cookie).not.toContain(canary);
  expect(stored.history ?? '').not.toContain(canary);
});
