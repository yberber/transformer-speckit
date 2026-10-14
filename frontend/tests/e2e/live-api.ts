// Mock inference API for the @live and @privacy specs, fed by the shared contract fixtures
// (contracts/fixtures/api/). The `live` Playwright project builds the site with
// VITE_API_BASE_URL=http://api.test; nothing here talks to a real server.
import { readdirSync, readFileSync } from 'node:fs';
import type { Page, Request, Route } from '@playwright/test';

export const API = 'http://api.test';

export interface Fixture {
  request?: Record<string, unknown>;
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

const FIXTURES = new URL('../../../contracts/fixtures/api/', import.meta.url);
const fixtures: Record<string, Fixture> = Object.fromEntries(
  readdirSync(FIXTURES)
    .filter((f) => f.endsWith('.json'))
    .map((f) => [
      f.replace(/\.json$/, ''),
      JSON.parse(readFileSync(new URL(f, FIXTURES), 'utf-8')),
    ]),
);

export function fixture(name: string): Fixture {
  const f = fixtures[name];
  if (!f) throw new Error(`no fixture ${name}`);
  return structuredClone(f);
}

export const CORS = { 'access-control-allow-origin': '*' };

export type Endpoint = 'health' | 'runs' | 'attention' | 'token-embeddings';
/** Answers one request; `n` counts the requests to this endpoint so far, from 0. */
export type Handler = (route: Route, request: Request, n: number) => Promise<void>;

export function json(route: Route, f: Fixture, cors = true): Promise<void> {
  return route.fulfill({
    status: f.status,
    headers: { 'content-type': 'application/json', ...(cors ? CORS : {}), ...f.headers },
    body: JSON.stringify(f.body),
  });
}

export function startingPage(route: Route, cors = true): Promise<void> {
  return route.fulfill({
    status: 200,
    headers: { 'content-type': 'text/html', ...(cors ? CORS : {}) },
    body: '<!doctype html><title>Starting</title><p>This Space is starting.</p>',
  });
}

const defaults: Record<Endpoint, Handler> = {
  health: (route) => json(route, fixture('health')),
  runs: (route) => json(route, fixture('run')),
  attention: (route, request) => {
    // The fixture holds layer 1 of the run fixture; answer for the layer that was asked.
    const f = fixture('attention');
    (f.body as { layer: number }).layer = (request.postDataJSON() as { layer: number }).layer;
    return json(route, f);
  },
  'token-embeddings': (route) => json(route, fixture('token-embeddings')),
};

export interface ApiMock {
  /** Every request to the API, preflights excluded, in order. */
  requests: Request[];
  count(endpoint: Endpoint): number;
}

export async function mockApi(
  page: Page,
  handlers: Partial<Record<Endpoint, Handler>> = {},
): Promise<ApiMock> {
  const requests: Request[] = [];
  const counts: Record<Endpoint, number> = {
    health: 0,
    runs: 0,
    attention: 0,
    'token-embeddings': 0,
  };
  await page.route(`${API}/**`, async (route, request) => {
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          ...CORS,
          'access-control-allow-methods': 'GET, POST',
          'access-control-allow-headers': 'content-type',
        },
      });
      return;
    }
    requests.push(request);
    const endpoint = new URL(request.url()).pathname.replace('/api/v1/', '') as Endpoint;
    const handler = handlers[endpoint] ?? defaults[endpoint];
    if (!handler) {
      await route.fulfill({ status: 404, headers: CORS, body: '' });
      return;
    }
    await handler(route, request, counts[endpoint]++);
  });
  return { requests, count: (endpoint) => counts[endpoint] };
}

/** `{name}` placeholders, as the app's i18n fills them (small integers only). */
export function fill(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
}
