// Principle IX: the README explains every run, test, deploy and regeneration command. Any
// frontend script, backend tool or service entry point missing from it fails this check, and so
// does any `npm run`, `npx` or `uv run` command from the quickstart (as written, with arguments).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../../', import.meta.url);
const readme = readFileSync(new URL('README.md', ROOT), 'utf-8');
const pkg = JSON.parse(readFileSync(new URL('frontend/package.json', ROOT), 'utf-8')) as {
  scripts: Record<string, string>;
};

const quickstart = readFileSync(
  new URL('specs/001-inside-the-transformer/quickstart.md', ROOT),
  'utf-8',
);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Markdown may wrap a long inline command over two lines; compare with whitespace collapsed. */
const flat = (s: string) => s.replace(/\s+/g, ' ');
const readmeFlat = flat(readme);
/** The command appears in the README, not as a prefix of a longer one (test:e2e vs test:e2e:x). */
const mentions = (command: string) =>
  new RegExp(`${escape(flat(command))}(?![\\w:.-])`).test(readmeFlat);

/**
 * Every `npm run …`, `npx …` and `uv run …` command in the quickstart, from code blocks and inline
 * code alike, with its arguments. A command ends at the end of its line or code span, at `&&`, or
 * at a shell comment.
 */
function quickstartCommands(text: string): string[] {
  const commands = text
    .split(/\n|`|&&/)
    .map((segment) => /(?:npm run|npx|uv run) .+/.exec(segment)?.[0])
    .filter((c): c is string => c !== undefined)
    .map((c) => c.replace(/\s#.*$/, '').trim());
  return [...new Set(commands)];
}

function required(): string[] {
  const commands = Object.keys(pkg.scripts).map((name) => `npm run ${name}`);
  const tools = readdirSync(new URL('backend/tools/', ROOT)).filter(
    (f) => f.endsWith('.py') && f !== '__init__.py',
  );
  commands.push(...tools.map((f) => `python -m tools.${f.replace(/\.py$/, '')}`));
  if (existsSync(new URL('backend/app/main.py', ROOT))) commands.push('uvicorn app.main:app');
  return commands;
}

describe('README', () => {
  it('documents every npm script, backend tool and service entry point', () => {
    const commands = required();
    expect(commands.length).toBeGreaterThan(0);
    const missing = commands.filter((c) => !mentions(c));
    expect(missing, `README.md does not mention:\n${missing.join('\n')}`).toEqual([]);
  });

  it('contains every npm run, npx and uv run command from the quickstart', () => {
    const commands = quickstartCommands(quickstart);
    expect(commands).toContain('uv run python -m tools.verify_examples');
    expect(commands).toContain('npm run test:e2e:fullstack');
    const missing = commands.filter((c) => !mentions(c));
    expect(missing, `README.md does not contain:\n${missing.join('\n')}`).toEqual([]);
  });

  it('reads quickstart commands as written', () => {
    expect(
      quickstartCommands(
        [
          '```bash',
          'cd frontend && npm run build && npm run preview          # VITE_API_BASE_URL unset',
          'cd ../backend && uv run pytest tests/privacy',
          '```',
          'Automated: `npm run test:e2e -- --grep @live` and `npx playwright install chromium`.',
          'npm run test:e2e -- --grep "@a11y|@keyboard"',
        ].join('\n'),
      ),
    ).toEqual([
      'npm run build',
      'npm run preview',
      'uv run pytest tests/privacy',
      'npm run test:e2e -- --grep @live',
      'npx playwright install chromium',
      'npm run test:e2e -- --grep "@a11y|@keyboard"',
    ]);
  });
});
