#!/usr/bin/env node
// Performance budgets (Principle VII), checked on the production build in dist/:
//
// 1. Every data file under dist/data/ is smaller than limits.file_budget_bytes.
// 2. The initial load is smaller than limits.initial_load_budget_bytes. It counts what the first
//    view needs: index.html, the entry chunk and its static imports (dist/.vite/manifest.json),
//    their CSS, the fonts the first view renders with (every @font-face whose unicode-range
//    covers basic Latin; the latin-ext subsets load only when a page contains those characters),
//    data/examples/index.json and the default (first) example's core.json.
//
// Sizes are raw bytes on disk (1 MB = 1,000,000 B), stricter than compressed transfer size.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const limits = JSON.parse(readFileSync(join(root, '..', 'contracts', 'limits.json'), 'utf-8'));

if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html not found: run `npm run build` first.');
  process.exit(1);
}

const size = (rel) => statSync(join(dist, rel)).size;
const failures = [];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

// 1. Per-file budget for data files.
const dataFiles = existsSync(join(dist, 'data')) ? walk(join(dist, 'data')) : [];
if (dataFiles.length === 0) failures.push('no data files found under dist/data/');
let largest = { file: '', bytes: 0 };
for (const file of dataFiles) {
  const bytes = statSync(file).size;
  if (bytes > largest.bytes) largest = { file: relative(dist, file), bytes };
  if (bytes >= limits.file_budget_bytes) {
    failures.push(`${relative(dist, file)}: ${bytes} B ≥ ${limits.file_budget_bytes} B per file`);
  }
}

// 2. Initial-load set.
const manifest = JSON.parse(readFileSync(join(dist, '.vite', 'manifest.json'), 'utf-8'));
const entries = Object.values(manifest).filter((c) => c.isEntry);
if (entries.length !== 1) failures.push(`expected one entry chunk, found ${entries.length}`);

const initial = new Map(); // dist-relative path → reason
const add = (rel, reason) => {
  if (!initial.has(rel)) initial.set(rel, reason);
};
add('index.html', 'page');

const seen = new Set();
function addChunk(key, reason) {
  if (seen.has(key)) return;
  seen.add(key);
  const chunk = manifest[key];
  add(chunk.file, reason);
  for (const css of chunk.css ?? []) add(css, 'CSS');
  for (const asset of chunk.assets ?? []) add(asset, 'asset');
  for (const dep of chunk.imports ?? []) addChunk(dep, 'static import');
}
for (const [key, chunk] of Object.entries(manifest)) {
  if (chunk.isEntry) addChunk(key, 'entry chunk');
}

// Fonts: @font-face rules in the initial CSS whose unicode-range includes U+0000-00FF.
const base = process.env.VITE_BASE ?? '/';
for (const css of [...initial.keys()].filter((f) => f.endsWith('.css'))) {
  const text = readFileSync(join(dist, css), 'utf-8');
  for (const face of text.match(/@font-face\s*{[^}]*}/g) ?? []) {
    const range = face.match(/unicode-range:([^;}]*)/)?.[1] ?? 'U+0-10FFFF';
    if (!/U\+0+-0*FF\b/i.test(range) && !/U\+0-10FFFF/i.test(range)) continue;
    for (const [, url] of face.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
      const path = url.startsWith(base)
        ? url.slice(base.length)
        : posix.join(posix.dirname(css), url);
      add(path.replace(/^\//, ''), 'font (latin)');
    }
  }
}

const indexRel = 'data/examples/index.json';
add(indexRel, 'example index');
const index = JSON.parse(readFileSync(join(dist, indexRel), 'utf-8'));
const defaultCore = posix.join(posix.dirname(indexRel), index.examples[0].core);
add(defaultCore, 'default example core.json');

let total = 0;
const rows = [];
for (const [rel, reason] of initial) {
  if (!existsSync(join(dist, rel))) {
    failures.push(`initial-load file missing: ${rel}`);
    continue;
  }
  const bytes = size(rel);
  total += bytes;
  rows.push([rel, reason, bytes]);
}
if (total >= limits.initial_load_budget_bytes) {
  failures.push(`initial load ${total} B ≥ ${limits.initial_load_budget_bytes} B`);
}

const fmt = (n) => n.toLocaleString('en-US');
const width = Math.max(...rows.map(([f]) => f.length), 20);
console.log('Initial load');
for (const [file, reason, bytes] of rows.sort((a, b) => b[2] - a[2])) {
  console.log(`  ${file.padEnd(width)}  ${fmt(bytes).padStart(10)} B  ${reason}`);
}
console.log(
  `  ${'TOTAL'.padEnd(width)}  ${fmt(total).padStart(10)} B  budget < ${fmt(limits.initial_load_budget_bytes)} B`,
);
console.log(
  `\nData files: ${dataFiles.length}, largest ${largest.file} ${fmt(largest.bytes)} B, budget < ${fmt(limits.file_budget_bytes)} B each`,
);

if (failures.length) {
  console.error(`\nFAILED budgets:\n${failures.map((f) => `  ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('\nOK: all budgets met');
