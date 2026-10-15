// US2, quickstart Q1/Q10, FR-015–FR-017, FR-038: the Embeddings, Blocks and Attention views show
// real numbers for every token up to the current step and work with the keyboard alone. Values on
// screen are compared against the committed core.json and the decoded binary files.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

interface BinaryFile {
  path: string;
  shape: number[];
  scale?: number;
}
interface Core {
  example: { id: string };
  run: {
    n_input: number;
    steps: number;
    tokens: { id: number; bytes: number[] }[];
    layers: { attn_change_pct: number[]; mlp_change_pct: number[] }[];
  };
  files: { embeddings_token: BinaryFile & { unique_ids: number[] }; attention: BinaryFile[] };
}

const config = JSON.parse(
  readFileSync(new URL('../../src/generated/gpt2-config.json', import.meta.url), 'utf-8'),
) as { n_layer: number; n_head: number; n_embd: number; n_inner: number | null };
// HF GPT-2 semantics: n_inner = null means an MLP of 4 × n_embd (as in src/lib/model/config.ts).
const nInner = config.n_inner ?? 4 * config.n_embd;

const EXAMPLES = new URL('../../public/data/examples/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', EXAMPLES), 'utf-8')) as {
  examples: { id: string; core: string }[];
};
function loadCore(id: string): { core: Core; url: URL } {
  const entry = index.examples.find((e) => e.id === id)!;
  const url = new URL(entry.core, EXAMPLES);
  return { core: JSON.parse(readFileSync(url, 'utf-8')) as Core, url };
}

function decode(file: BinaryFile, coreUrl: URL, dtype: 'uint16' | 'float32'): Float32Array {
  const buf = readFileSync(new URL(file.path, coreUrl));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  if (dtype === 'float32') return new Float32Array(ab);
  const stored = new Uint16Array(ab);
  const out = new Float32Array(stored.length);
  for (let i = 0; i < stored.length; i++) out[i] = stored[i]! * (file.scale ?? 1);
  return out;
}

const first = loadCore(index.examples[0]!.id);
const longest = index.examples
  .map((e) => loadCore(e.id))
  .reduce((a, b) => (b.core.run.tokens.length > a.core.run.tokens.length ? b : a));

const en = (options: Intl.NumberFormatOptions) => new Intl.NumberFormat('en-US', options);
const pct1 = (v: number) =>
  en({ style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v / 100);
const dec3 = (v: number) => en({ minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v);
const sig6 = (v: number) =>
  en({ minimumSignificantDigits: 6, maximumSignificantDigits: 6 }).format(v);
const sig7 = (v: number) =>
  en({ minimumSignificantDigits: 7, maximumSignificantDigits: 7 }).format(v);

/** Layer 1, head 1 of an example: weight(i, j) and the keys of row i, largest weight first. */
function firstHead(example: { core: Core; url: URL }) {
  const heads = decode(example.core.files.attention[0]!, example.url, 'uint16');
  const weight = (i: number, j: number) => heads[(i * (i + 1)) / 2 + j]!;
  const ranked = (i: number) =>
    Array.from({ length: i + 1 }, (_, j) => j).sort((a, b) => weight(i, b) - weight(i, a) || a - b);
  return { weight, ranked };
}

test.use({ locale: 'en-US' });

async function openView(page: Page, view: string): Promise<void> {
  await page.locator(`nav a[data-view="${view}"]`).click();
  await expect(page.locator(`section[data-view="${view}"]`)).toBeVisible();
  // Park the pointer in the page margin: when focus scrolls the page, Chrome hovers whatever is
  // under a resting pointer, and a hovered token would move the heatmap's selection.
  await page.mouse.move(0, 0);
}

async function selectExample(page: Page, id: string): Promise<void> {
  await page.locator(`[data-example-picker] input[value="${id}"]`).check();
  await expect(page.locator('[data-step-counter]')).toHaveAttribute('data-step', '0');
}

test.describe('@layers', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await selectExample(page, first.core.example.id);
  });

  test('@layers embeddings: three labelled strips per token and an n_embd-row table', async ({
    page,
  }) => {
    const { core, url } = first;
    const n = core.run.n_input;
    await openView(page, 'embeddings');
    const view = page.locator('section[data-view="embeddings"]');

    const rows = view.locator('[data-embedding-row]');
    await expect(rows).toHaveCount(n);
    const strips = view.locator('canvas[data-strip]');
    await expect(strips).toHaveCount(3 * n);
    for (const kind of ['token', 'position', 'sum']) {
      await expect(rows.first().locator(`canvas[data-strip="${kind}"]`)).toHaveAttribute(
        'role',
        'img',
      );
    }
    const names = await strips.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
    expect(names.every((name) => name !== null && name.trim().length > 0)).toBe(true);

    // Choose token 2 with the keyboard: its table lists every dimension.
    const chosen = 1;
    const select = rows.nth(chosen).locator('[data-select-token]');
    await select.focus();
    await page.keyboard.press('Enter');
    await expect(select).toHaveAttribute('aria-pressed', 'true');
    const table = view.locator('[data-vector-table]');
    await expect(table).toBeVisible();
    await expect(table).toHaveAttribute('aria-rowcount', String(config.n_embd + 1));
    await expect(table).toHaveAttribute('data-position', String(chosen));

    // Dimension 1 shows the real token embedding of that token.
    const emb = core.files.embeddings_token;
    const r = emb.unique_ids.indexOf(core.run.tokens[chosen]!.id);
    const wte = decode(emb, url, 'float32');
    const firstRow = table.locator('[data-dimension="0"]');
    await expect(firstRow.locator('[data-col="token"]')).toHaveText(sig6(wte[r * config.n_embd]!));

    // The last dimension is reachable by scrolling the (virtualized) table.
    const scroller = view.locator('[data-vector-scroll]');
    await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(table.locator(`[data-dimension="${config.n_embd - 1}"]`)).toBeVisible();
  });

  test('@layers blocks: layers 1 to n_layer with real change percentages', async ({ page }) => {
    const { core } = first;
    await openView(page, 'blocks');
    const view = page.locator('section[data-view="blocks"]');
    const label = view.locator('[data-layer-label]');

    await expect(label).toHaveAttribute('data-layer', '1');
    await expect(label).toContainText(`of ${config.n_layer}`);

    // The MLP expands d → f → d, sizes from the config.
    const fmt = en({});
    await expect(view.locator('[data-mlp-size="in"]')).toHaveText(fmt.format(config.n_embd));
    await expect(view.locator('[data-mlp-size="hidden"]')).toHaveText(fmt.format(nInner));
    await expect(view.locator('[data-mlp-size="out"]')).toHaveText(fmt.format(config.n_embd));

    const next = view.locator('[data-action="next-layer"]');
    const prev = view.locator('[data-action="prev-layer"]');
    const attn0 = view.locator('[data-change-bars="attn"] [data-change-row]').first();
    const mlp0 = view.locator('[data-change-bars="mlp"] [data-change-row]').first();
    for (let l = 1; l <= config.n_layer; l++) {
      await expect(label).toHaveAttribute('data-layer', String(l));
      const layer = core.run.layers[l - 1]!;
      await expect(attn0.locator('[data-change-value]')).toHaveText(
        pct1(layer.attn_change_pct[0]!),
      );
      await expect(mlp0.locator('[data-change-value]')).toHaveText(pct1(layer.mlp_change_pct[0]!));
      if (l < config.n_layer) await next.click();
    }
    await expect(next).toBeDisabled();
    await prev.click();
    await expect(label).toHaveAttribute('data-layer', String(config.n_layer - 1));

    // Direct selection.
    await view.locator('select[data-layer-select]').selectOption('4');
    await expect(label).toHaveAttribute('data-layer', '4');
    await expect(view.locator('[data-change-bars="attn"] [data-change-row]')).toHaveCount(
      core.run.n_input,
    );

    // "See this layer's attention heads" keeps the layer.
    await view.locator('[data-action="to-attention"]').click();
    await expect(page.locator('section[data-view="attention"]')).toBeVisible();
    await expect(page.locator('[data-layer-label]')).toHaveAttribute('data-layer', '4');
  });

  test('@layers attention: keyboard-only layer, head and cell selection', async ({ page }) => {
    const { core, url } = first;
    const n = core.run.n_input;
    await openView(page, 'attention');
    const view = page.locator('section[data-view="attention"]');

    // Layer 5, head 3 with the keyboard only.
    const nextLayer = view.locator('[data-action="next-layer"]');
    await nextLayer.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('Enter');
    const nextHead = view.locator('[data-action="next-head"]');
    await nextHead.focus();
    for (let i = 0; i < 2; i++) await page.keyboard.press('Enter');
    await expect(view.locator('[data-layer-label]')).toHaveAttribute('data-layer', '5');
    await expect(view.locator('[data-head-label]')).toHaveAttribute('data-head', '3');

    const heads = decode(core.files.attention[4]!, url, 'uint16');
    const packed = core.files.attention[4]!.shape[1]!;
    const weight = (i: number, j: number) => heads[2 * packed + (i * (i + 1)) / 2 + j]!;

    const grid = view.locator('[data-heatmap-grid]');
    await expect(grid).toHaveAttribute('data-size', String(n));
    const readout = view.locator('[data-heatmap-readout]');
    await grid.focus();
    await expect(grid).toHaveAttribute('data-active', '0,0');

    // Masked (future) cells are never selected: from (0, 0) right stays put.
    await page.keyboard.press('ArrowRight');
    await expect(grid).toHaveAttribute('data-active', '0,0');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(grid).toHaveAttribute('data-active', '2,0');
    await page.keyboard.press('ArrowRight');
    await expect(grid).toHaveAttribute('data-active', '2,1');
    await expect(readout).toContainText('from');
    await expect(readout).toContainText(`: ${dec3(weight(2, 1))}`);
    await page.keyboard.press('End');
    await expect(grid).toHaveAttribute('data-active', '2,2');
    await page.keyboard.press('ArrowRight');
    await expect(grid).toHaveAttribute('data-active', '2,2');
    await page.keyboard.press('Home');
    await expect(grid).toHaveAttribute('data-active', '2,0');
    await page.keyboard.press('PageDown');
    await expect(grid).toHaveAttribute('data-active', `${n - 1},0`);
    await page.keyboard.press('End');
    await expect(grid).toHaveAttribute('data-active', `${n - 1},${n - 1}`);
    await expect(readout).toContainText(`: ${dec3(weight(n - 1, n - 1))}`);
    // Moving up from the diagonal lands on the nearest valid cell of the row above.
    await page.keyboard.press('ArrowUp');
    await expect(grid).toHaveAttribute('data-active', `${n - 2},${n - 2}`);

    // The focused cell's tokens are highlighted in the sequence above.
    await expect(
      view.locator(`[data-token-sequence] [data-position="${n - 2}"]`).first(),
    ).toHaveClass(/highlighted/);

    // "Show as table": every row sums to 1 within display rounding.
    await view.locator('[data-show-table]').click();
    const table = view.locator('[data-heatmap-table]');
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(n);
    for (let i = 0; i < n; i++) {
      const cells = await rows.nth(i).locator('td[data-weight]').allTextContents();
      expect(cells).toHaveLength(i + 1);
      const sum = cells.reduce((s, c) => s + Number(c), 0);
      expect(Math.abs(sum - 1)).toBeLessThanOrEqual((i + 1) * 0.0005 + 1e-9);
      expect(cells[i]).toBe(dec3(weight(i, i)));
    }
  });

  test('@layers attention: focusing or hovering a token selects its strongest pair', async ({
    page,
  }) => {
    const n = first.core.run.n_input;
    const { weight, ranked } = firstHead(first);
    await openView(page, 'attention');
    const view = page.locator('section[data-view="attention"]');
    const grid = view.locator('[data-heatmap-grid]');
    await expect(view.locator('[data-heatmap]')).toHaveAttribute('data-mode', 'grid');
    await expect(grid).toHaveAttribute('data-size', String(n));
    const sequence = view.locator('[data-token-sequence]');
    const chip = (p: number) => sequence.locator(`[data-position="${p}"]`);
    const readout = view.locator('[data-heatmap-readout]');

    // Keyboard: the last token and the token it attends to most.
    const k = n - 1;
    const key = ranked(k)[0]!;
    await sequence.locator('button').nth(k).focus();
    await expect(grid).toHaveAttribute('data-active', `${k},${key}`);
    await expect(chip(k)).toHaveClass(/highlighted/);
    await expect(chip(key)).toHaveClass(/highlighted/);
    await expect(readout).toContainText(`from token ${k + 1} (`);
    await expect(readout).toContainText(`to token ${key + 1} (`);
    await expect(readout).toContainText(`: ${dec3(weight(k, key))}`);

    // The exact weight of that pair is available on demand.
    await view.locator('[data-heatmap] [data-show-details]').click();
    await expect(view.locator('[data-heatmap-exact]')).toContainText(sig7(weight(k, key)));

    // Pointer: hovering another token moves the selection to its pair.
    const m = Math.floor(n / 2);
    const mKey = ranked(m)[0]!;
    await chip(m).hover();
    await expect(grid).toHaveAttribute('data-active', `${m},${mKey}`);
    await expect(chip(m)).toHaveClass(/highlighted/);
    await expect(chip(mKey)).toHaveClass(/highlighted/);
    await expect(readout).toContainText(`: ${dec3(weight(m, mKey))}`);
    await expect(view.locator('[data-heatmap-exact]')).toContainText(sig7(weight(m, mKey)));
  });

  test('@layers advancing a step adds a row and a column', async ({ page }) => {
    const n = first.core.run.n_input;
    await openView(page, 'attention');
    const view = page.locator('section[data-view="attention"]');
    await expect(view.locator('[data-heatmap-grid]')).toHaveAttribute('data-size', String(n));
    await page.locator('[data-action="next"]').click();
    await expect(view.locator('[data-heatmap-grid]')).toHaveAttribute('data-size', String(n + 1));
    await view.locator('[data-show-table]').click();
    await expect(view.locator('[data-heatmap-table] tbody tr')).toHaveCount(n + 1);
    await expect(view.locator('[data-heatmap-table] thead th[scope="col"]')).toHaveCount(n + 1);

    await openView(page, 'embeddings');
    await expect(page.locator('[data-embedding-row]')).toHaveCount(n + 1);
    await openView(page, 'blocks');
    await expect(page.locator('[data-change-bars="mlp"] [data-change-row]')).toHaveCount(n + 1);
  });
});

test('@layers focused mode: tokens and ranked rows select a pair with its exact weight', async ({
  page,
}) => {
  // A phone-width viewport on every project, so the longest example uses focused mode.
  await page.setViewportSize({ width: 360, height: 780 });
  const { weight, ranked } = firstHead(longest);
  await page.goto('/');
  await selectExample(page, longest.core.example.id);
  await openView(page, 'attention');
  const view = page.locator('section[data-view="attention"]');
  await expect(view.locator('[data-heatmap]')).toHaveAttribute('data-mode', 'focused');
  const sequence = view.locator('[data-token-sequence]');
  const chip = (p: number) => sequence.locator(`[data-position="${p}"]`);
  const readout = view.locator('[data-heatmap-readout]');
  const list = view.locator('[data-ranked-list]');

  // Focusing a token picks it and its strongest key.
  const k = 10;
  const order = ranked(k);
  await sequence.locator('button').nth(k).focus();
  await expect(view.locator('select[data-focus-token]')).toHaveValue(String(k));
  const active = list.locator('button[data-active="true"]');
  await expect(active).toHaveAttribute('data-key', String(order[0]));
  await expect(chip(k)).toHaveClass(/highlighted/);
  await expect(chip(order[0]!)).toHaveClass(/highlighted/);
  await expect(readout).toContainText(`: ${dec3(weight(k, order[0]!))}`);

  // The ranked rows are one tab stop; arrow keys move, and the focused row's pair is highlighted.
  await expect(list.locator('button[tabindex="0"]')).toHaveCount(1);
  await active.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator(':focus')).toHaveAttribute('data-key', String(order[1]));
  await expect(chip(k)).toHaveClass(/highlighted/);
  await expect(chip(order[1]!)).toHaveClass(/highlighted/);
  await expect(readout).toContainText(`to token ${order[1]! + 1} (`);
  await expect(readout).toContainText(`: ${dec3(weight(k, order[1]!))}`);

  // The exact weight (7 significant digits) is available on demand.
  await view.locator('[data-heatmap] [data-show-details]').click();
  await expect(view.locator('[data-heatmap-exact]')).toContainText(sig7(weight(k, order[1]!)));

  // Hovering a row highlights its pair too.
  await list.locator(`[data-key="${order[2]}"]`).hover();
  await expect(chip(order[2]!)).toHaveClass(/highlighted/);
  await expect(readout).toContainText(`to token ${order[2]! + 1} (`);
  await expect(view.locator('[data-heatmap-exact]')).toContainText(sig7(weight(k, order[2]!)));
});

test('@layers mobile: long contexts switch the heatmap to focused mode', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'focused mode is a narrow-screen layout');
  const { core, url } = longest;
  const n = core.run.n_input;
  await page.goto('/');
  await selectExample(page, core.example.id);
  await openView(page, 'attention');
  const view = page.locator('section[data-view="attention"]');

  await expect(view.locator('[data-heatmap]')).toHaveAttribute('data-mode', 'focused');
  const picker = view.locator('select[data-focus-token]');
  await expect(picker.locator('option')).toHaveCount(n);
  await picker.selectOption(String(n - 1));

  // Layer 1, head 1: the ranked list holds all n weights of the last token, largest first.
  const heads = decode(core.files.attention[0]!, url, 'uint16');
  const row = Array.from(heads.subarray(((n - 1) * n) / 2, (n * (n + 1)) / 2));
  const items = view.locator('[data-ranked-list] > li');
  await expect(items).toHaveCount(n);
  const values = (await items.locator('[data-weight]').allTextContents()).map(Number);
  for (let i = 1; i < values.length; i++) expect(values[i - 1]).toBeGreaterThanOrEqual(values[i]!);
  expect(values[0]).toBe(Number(dec3(Math.max(...row))));
});
