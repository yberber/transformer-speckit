// SC-008: every user-facing string exists in English, Turkish and German.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import de from '../../../src/lib/i18n/de.json';
import en from '../../../src/lib/i18n/en.json';
import glossaryDe from '../../../src/lib/i18n/glossary.de.json';
import glossaryEn from '../../../src/lib/i18n/glossary.en.json';
import glossaryTr from '../../../src/lib/i18n/glossary.tr.json';
import tr from '../../../src/lib/i18n/tr.json';

type Catalog = Record<string, string>;
type Glossary = Record<string, { term: string; explanation: string }>;

const ROOT = new URL('../../../../', import.meta.url);
const catalogs: Record<string, Catalog> = { en, tr, de };
const glossaries: Record<string, Glossary> = { en: glossaryEn, tr: glossaryTr, de: glossaryDe };

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** The `ErrorCode` enum of the OpenAPI contract (a flat YAML list, read without a YAML library). */
function apiErrorCodes(): string[] {
  const yaml = readFileSync(new URL('contracts/inference-api.openapi.yaml', ROOT), 'utf-8');
  const block = yaml.match(/\n {4}ErrorCode:\n {6}enum:\n((?: {8}- [a-z_]+\n)+)/);
  if (!block) throw new Error('ErrorCode enum not found in inference-api.openapi.yaml');
  return block[1]!
    .trim()
    .split('\n')
    .map((l) => l.replace(/^\s*- /, ''));
}

const CLIENT_ERROR_CODES = [
  'timeout',
  'network',
  'wake_timeout',
  'version_mismatch',
  'invalid_response',
];

describe('locale catalogs', () => {
  it.each(['tr', 'de'])('%s has exactly the keys of en', (locale) => {
    expect(Object.keys(catalogs[locale]!).sort()).toEqual(Object.keys(en).sort());
  });

  it.each(['en', 'tr', 'de'])('%s has no empty values', (locale) => {
    for (const [key, value] of Object.entries(catalogs[locale]!)) {
      expect(value.trim(), `${locale}: ${key}`).not.toBe('');
    }
  });

  it.each(['tr', 'de'])('%s uses the same {placeholders} as en for every key', (locale) => {
    for (const [key, value] of Object.entries(en as Catalog)) {
      expect(placeholders(catalogs[locale]![key]!), `${locale}: ${key}`).toEqual(
        placeholders(value),
      );
    }
  });

  it('has a message for every API and client error code', () => {
    const codes = apiErrorCodes();
    expect(codes.length).toBeGreaterThan(0);
    for (const code of [...codes, ...CLIENT_ERROR_CODES]) {
      expect(en, `error.${code}`).toHaveProperty([`error.${code}`]);
    }
  });

  it('has a title for every example in index.json', () => {
    const index = JSON.parse(
      readFileSync(new URL('frontend/public/data/examples/index.json', ROOT), 'utf-8'),
    ) as { examples: { id: string }[] };
    for (const { id } of index.examples) {
      expect(en, `example.${id}.title`).toHaveProperty([`example.${id}.title`]);
    }
  });
});

describe('glossary', () => {
  const ids = Object.keys(glossaryEn).sort();

  it('covers the minimum term set (FR-030)', () => {
    expect(ids).toEqual(
      [
        'token',
        'attention',
        'embedding',
        'layer',
        'head',
        'mlp',
        'logit',
        'probability-distribution',
        'prefill',
        'decode',
        'flops',
        'kv-cache',
      ].sort(),
    );
  });

  it.each(['tr', 'de'])('%s has the same term ids as en, with the English term', (locale) => {
    const g = glossaries[locale]!;
    expect(Object.keys(g).sort()).toEqual(ids);
    for (const id of ids) expect(g[id]!.term, id).toBe((glossaryEn as Glossary)[id]!.term);
  });

  it.each(['en', 'tr', 'de'])('%s has a non-empty explanation for every term', (locale) => {
    for (const [id, entry] of Object.entries(glossaries[locale]!)) {
      expect(entry.term.trim(), `${locale}: ${id}`).not.toBe('');
      expect(entry.explanation.trim(), `${locale}: ${id}`).not.toBe('');
    }
  });
});
