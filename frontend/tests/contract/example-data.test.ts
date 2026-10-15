import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { limits } from '../../src/lib/limits';

const ROOT = new URL('../../../', import.meta.url);
const schema = JSON.parse(
  readFileSync(new URL('contracts/example-data.schema.json', ROOT), 'utf-8'),
) as { $id: string };
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(schema);
const validator = (def: string) => {
  const v = ajv.getSchema(`${schema.$id}#/$defs/${def}`);
  if (!v) throw new Error(`no schema for ${def}`);
  return v;
};

const EXAMPLES = new URL('frontend/public/data/examples/', ROOT);
const DATA = new URL('frontend/public/data/', ROOT);
const TINY = new URL('contracts/fixtures/data/tiny-example/', ROOT);

// Input token bands per length category (data-model.md "Example").
const BANDS = { short: [5, 15], medium: [20, 35], long: [50, 64] } as const;

interface FileEntry {
  path: string;
  bytes: number;
  sha256: string;
}
interface Core {
  example: { id: string; length: keyof typeof BANDS; text: string };
  model: { revision: string };
  run: { n_input: number };
  files: { embeddings_token: FileEntry; attention: FileEntry[] };
}

const readJson = <T>(url: URL): T => JSON.parse(readFileSync(url, 'utf-8')) as T;
const index = readJson<{
  model: { revision: string };
  examples: { id: string; length: keyof typeof BANDS; n_input: number; core: string }[];
  position_embeddings: FileEntry[];
}>(new URL('index.json', EXAMPLES));
const cores = index.examples.map((e) => ({
  url: new URL(e.core, EXAMPLES),
  core: readJson<Core>(new URL(e.core, EXAMPLES)),
}));
const tiny = { url: new URL('core.json', TINY), core: readJson<Core>(new URL('core.json', TINY)) };

function checkFile(base: URL, entry: FileEntry): void {
  const data = readFileSync(new URL(entry.path, base));
  expect(data.byteLength, entry.path).toBe(entry.bytes);
  expect(createHash('sha256').update(data).digest('hex'), entry.path).toBe(entry.sha256);
}

function listFiles(dir: URL): string[] {
  const root = fileURLToPath(dir);
  return readdirSync(root, { recursive: true, encoding: 'utf-8' })
    .map((f) => `${root}${f}`)
    .filter((f) => statSync(f).isFile());
}

describe('example data against contracts/example-data.schema.json', () => {
  it('index.json is a valid ExampleIndex', () => {
    const validate = validator('ExampleIndex');
    expect(validate(index), ajv.errorsText(validate.errors)).toBe(true);
  });

  it.each([...cores, tiny].map((c) => [c.core.example.id, c] as const))(
    '%s core.json is a valid ExampleCore',
    (_, { core }) => {
      const validate = validator('ExampleCore');
      expect(validate(core), ajv.errorsText(validate.errors)).toBe(true);
    },
  );

  it('every listed file has the recorded size and sha256', () => {
    for (const { url, core } of [...cores, tiny]) {
      for (const f of [core.files.embeddings_token, ...core.files.attention]) checkFile(url, f);
    }
    for (const shard of index.position_embeddings)
      checkFile(new URL('index.json', EXAMPLES), shard);
  });

  it('every data file is under the per-file budget', () => {
    const files = [...listFiles(DATA), ...listFiles(TINY)];
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(statSync(f).size, f).toBeLessThan(limits.file_budget_bytes);
    }
  });

  it('has exactly two short, two medium and two long examples within their token bands', () => {
    for (const length of Object.keys(BANDS) as (keyof typeof BANDS)[]) {
      expect(index.examples.filter((e) => e.length === length)).toHaveLength(2);
    }
    for (const { core } of cores) {
      const [lo, hi] = BANDS[core.example.length];
      expect(core.run.n_input, core.example.id).toBeGreaterThanOrEqual(lo);
      expect(core.run.n_input, core.example.id).toBeLessThanOrEqual(
        Math.min(hi, limits.max_input_tokens),
      );
      expect(index.examples.find((e) => e.id === core.example.id)?.length).toBe(
        core.example.length,
      );
    }
  });

  it("lists each example's input token count in index.json, equal to its core.json", () => {
    for (const { core } of cores) {
      const entry = index.examples.find((e) => e.id === core.example.id);
      expect(entry?.n_input, core.example.id).toBe(core.run.n_input);
    }
  });

  it('has no example text ending with a question mark', () => {
    for (const { core } of cores) expect(core.example.text.trimEnd().endsWith('?')).toBe(false);
  });

  it('records the same model revision everywhere', () => {
    for (const { core } of cores) expect(core.model.revision).toBe(index.model.revision);
  });
});
