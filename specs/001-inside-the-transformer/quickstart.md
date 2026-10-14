# Quickstart & Validation Guide: Inside the Transformer

**Feature**: `001-inside-the-transformer` | **Plan**: [plan.md](./plan.md)

Runnable scenarios that prove the feature works end to end. Commands refer to the layout in
[plan.md](./plan.md#project-structure); formats and limits are in [contracts/](./contracts/).
The README (repo root) carries the user-facing version of these steps (Principle IX).

## Prerequisites

| Tool | Version | Used for |
|---|---|---|
| Node.js | 22 LTS | frontend build, unit/e2e tests |
| Python | 3.12 | inference service, generator, verifier |
| uv | ≥ 0.4 | Python env + lockfile |
| Docker | any recent | optional: run the Space image locally |
| Disk / network | ~1 GB, first run only | GPT-2 small weights (pinned revision) |

```bash
cd frontend && npm ci && npx playwright install --with-deps chromium
cd ../backend && uv sync
```

## Q1 — Example mode works with no server (US1, US2, US3; SC-004, FR-004)

```bash
cd frontend && npm run build && npm run preview          # VITE_API_BASE_URL unset
```

Open the printed URL. Expected: example mode active, an example preselected, the "GPT-2
continues text" note visible; six examples (2 short / 2 medium / 2 long); Tokenization →
Embeddings → Blocks → Attention → Prediction all render; "Next token" works up to step 20 and
then disables with the "example ends here" message; live mode is hidden (no API configured).
Automated: `npm run test:e2e -- --grep @example-mode` (also runs with network blocked after load).

## Q2 — Example data matches the reference model (FR-041; SC-001)

```bash
cd backend && uv run python -m tools.verify_examples
```

Expected: one line per example and step, then `PASS` — tokens identical, probabilities
≤ 1e-4 abs, attention ≤ 1e-3 abs, embeddings and change % ≤ 0.1 % relative, all SHA-256 match.
Exit code ≠ 0 on any breach. Sanity check that it can fail:
`uv run python -m tools.verify_examples --self-test` corrupts an in-memory copy and expects
failure.

## Q3 — Regenerate example data (README requirement)

```bash
cd backend && uv run python -m tools.generate_examples   # writes frontend/public/data/, frontend/src/generated/
git diff --stat                                            # expected: no changes on the same pinned revision + lockfile
```

Expected: generator enforces token bands, ≥ 1e-3 top-1/top-2 margin, and < 300,000 B per file;
then run Q2.

## Q4 — Calculations match hand-computed references (FR-042; SC-003)

```bash
cd frontend && npm run test:unit -- model/
```

Expected: params total 124,439,808; per-group shapes equal `tests/reference/param-shapes.json`;
FLOP and KV-cache values equal those in `tests/reference/gpt2-small.md` (e.g. decode(10) =
247,433,472; prefill(10) = 1,777,923,072; KV(1024) = 75,497,472 B).

## Q5 — Inference service and its contract (Principle IX; FR-013)

```bash
cd backend && uv run uvicorn app.main:app --port 7860
curl -s localhost:7860/api/v1/health
curl -s -X POST localhost:7860/api/v1/runs -H 'content-type: application/json' \
  -d '{"text":"The quick brown fox","max_new_tokens":3}'
```

Expected: health `status: ok` with model revision equal to `index.json`'s; run returns
`n_input`, `steps: 3`, 4 predictions, 12 layer entries. A 65-token input returns `422` with
`{"error":{"code":"input_too_long_tokens","params":{"limit":64,"actual":65}}}` and no echo of the
text.

Contract tests on both sides:

```bash
cd backend && uv run pytest tests/contract
cd frontend && npm run test:contract
```

## Q6 — Live mode equals example mode (FR-010; SC-002)

```bash
cd backend && uv run pytest tests/integration/test_live_matches_examples.py
```

Expected: for each example text, live tokens identical and every probability within 1e-4.

## Q7 — Live mode in the browser, including failure (US6; FR-011; SC-004)

```bash
cd frontend && VITE_API_BASE_URL=http://localhost:7860 npm run dev
```

1. With the service running: switch to live mode, enter text, run; all views behave as in
   example mode; a text ending in `?` shows the "continues text" tip.
2. Stop the service, run again: translated "unavailable" message within 10 s of the failure,
   "back to examples" works, other views keep working.

Automated: `npm run test:e2e -- --grep @live` (mocked from contract fixtures) and
`npm run test:e2e:fullstack` (starts the real backend).

## Q8 — Deployed wake-up behaviour (R13 open item)

After deploying, let the Space sleep, then open the site in live mode. Expected: "waking up"
status with cancel; either the run completes or a clear message appears within 60 s. Record
whether an API request alone wakes the Space; if not, confirm the message links to the Space
page.

## Q9 — Privacy canary (Principle IV; FR-012)

```bash
cd backend && uv run pytest tests/privacy
cd frontend && npm run test:e2e -- --grep @privacy
```

Expected: a unique canary string sent through every endpoint and error path appears in no log
record, no URL, no localStorage/sessionStorage/IndexedDB entry.

## Q10 — Accessibility, i18n, URL state (FR-029–FR-038, FR-033; SC-006–SC-008, SC-010)

```bash
cd frontend && npm run test:unit -- i18n url palette
npm run test:e2e -- --grep "@a11y|@keyboard|@i18n|@share"
```

Expected: axe reports 0 violations for every main view × light/dark × en/tr/de; all FR-043
scenarios pass keyboard-only; no missing translation keys; shared-link round trips identical;
invalid links fall back with a notice; reduced-motion run shows no animations.

## Q11 — Budgets and performance (Principle VII; SC-011)

```bash
cd frontend && npm run build && npm run check:budgets && npm run lhci
```

Expected: every data file < 300,000 B; initial-load set < 2,000,000 B; Lighthouse performance
≥ 0.90 (mobile preset) in example mode.

## Q12 — Deploy

- Frontend: push to `main` → GitHub Actions builds, runs Q1/Q4/Q10/Q11 checks, publishes to
  GitHub Pages with `VITE_API_BASE_URL` from repository variables.
- Backend: `cd backend && uv run python -m tools.deploy_space --space <user>/<space>` (uploads
  `backend/` incl. Dockerfile and Space README front matter; requires `HF_TOKEN`); set
  `ALLOWED_ORIGINS` in the Space settings. Then run Q8.
