// Quality Gate 2 / Principle I: architecture numbers are read from the model config, never
// written in application code. Generated files (src/generated/) are the only exception.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const GENERATED = join(SRC, 'generated');
const ARCH_LITERAL = /\b(768|3072|50257|1024|124439808)\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return path === GENERATED ? [] : sourceFiles(path);
    return /\.(ts|svelte)$/.test(e.name) ? [path] : [];
  });
}

describe('no architecture literals in src/', () => {
  const files = sourceFiles(SRC);

  it('scans the application sources', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.startsWith(GENERATED))).toBe(false);
  });

  it('finds none of 768, 3072, 50257, 1024 or 124439808', () => {
    const hits = files.flatMap((file) =>
      readFileSync(file, 'utf-8')
        .split('\n')
        .flatMap((line, i) =>
          ARCH_LITERAL.test(line) ? [`src/${relative(SRC, file)}:${i + 1}: ${line.trim()}`] : [],
        ),
    );
    expect(
      hits,
      `Architecture numbers must come from the model config:\n${hits.join('\n')}`,
    ).toEqual([]);
  });
});
