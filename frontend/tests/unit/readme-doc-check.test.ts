// Principle IX: the README explains every run, test, deploy and regeneration command. Any
// frontend script, backend tool or service entry point missing from it fails this check.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../../', import.meta.url);
const readme = readFileSync(new URL('README.md', ROOT), 'utf-8');
const pkg = JSON.parse(readFileSync(new URL('frontend/package.json', ROOT), 'utf-8')) as {
  scripts: Record<string, string>;
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The command appears in the README, not as a prefix of a longer one (test:e2e vs test:e2e:x). */
const mentions = (command: string) => new RegExp(`${escape(command)}(?![\\w:.-])`).test(readme);

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
});
