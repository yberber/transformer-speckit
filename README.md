# Inside the Transformer

A public website that lets curious non-experts watch GPT-2 small turn text into new text, one
token at a time, with real numbers: tokenization, embeddings, transformer blocks, attention,
next-token prediction, the architecture and what each token costs to compute. The UI is
available in English, Turkish and German.

The project has exactly two components:

- **`frontend/`**: a static Svelte 5 + TypeScript site built with Vite. **Example mode** (the
  default) reads six precomputed GPT-2 runs shipped as static files under
  `frontend/public/data/`. It never calls a server and never downloads a model.
- **`backend/`**: one stateless, CPU-only FastAPI + PyTorch service for **live mode**, meant for a
  Hugging Face Docker Space. The same computation code also generates and verifies the example
  data offline (`backend/tools/`).

The spec, plan and task list live in `specs/001-inside-the-transformer/`.

## Prerequisites

- Node.js 22 (see `frontend/.nvmrc`) and npm
- Python 3.12 and [uv](https://docs.astral.sh/uv/) (uv can install Python 3.12 for you)
- Optional: Docker, to build the inference service image

## Run locally

Install dependencies:

```sh
cd backend && uv sync     # Python 3.12 env from backend/uv.lock (CPU-only torch)
cd frontend && npm ci     # Node dependencies from frontend/package-lock.json
```

Frontend (run from `frontend/`):

- `npm run dev`: start the Vite dev server with hot reload.
- `npm run build`: build the static site into `frontend/dist/`. Set `VITE_BASE=/<repo>/` when
  the site is served from a sub-path (GitHub Pages). Live mode is hidden unless
  `VITE_API_BASE_URL` is set at build time.
- `npm run preview`: serve the built `frontend/dist/` locally.

Backend inference service (run from `backend/`):

- `ALLOWED_ORIGINS=http://localhost:5173 uv run uvicorn app.main:app --port 7860 --no-access-log`:
  start the live-mode service on port 7860. It answers at once and loads the pinned GPT-2
  weights in the background (the first start downloads them, about 550 MB); until they are
  loaded, `GET /api/v1/health` answers 503 `model_loading`. Always pass `--no-access-log`:
  uvicorn's access log records paths and client addresses, and the service writes its own
  request log with only the method, route template, status and duration.
- `ALLOWED_ORIGINS`: comma-separated origins allowed to call the service from a browser (CORS),
  e.g. `http://localhost:5173` for `npm run dev` or `http://localhost:4173` for
  `npm run preview`. Empty or unset allows no cross-origin caller.
- Optional limits, all read at start-up: `RL_RUNS_PER_MIN` (default 6) and `RL_RUNS_BURST` (3)
  for `/runs` per client, `RL_DETAIL_PER_MIN` (60) and `RL_DETAIL_BURST` (20) for
  `/attention` and `/token-embeddings`, `GATE_MAX_WAITING` (8) requests waiting for the model
  and `GATE_QUEUE_WAIT_S` (30) seconds each may wait; `TORCH_THREADS` (2) CPU threads for the
  model; `LIMITS_PATH` to read `limits.json` from somewhere other than `contracts/`.

To use the local service from the frontend, set `VITE_API_BASE_URL` when starting or building
it, e.g. `VITE_API_BASE_URL=http://localhost:7860 npm run dev` from `frontend/`. Live mode
appears only in builds where this variable is set.

## Test

Frontend (run from `frontend/`):

- `npm run lint`: ESLint over `.ts` and `.svelte` files, including the rule that rejects
  architecture numbers written as literals (Principle I).
- `npm run format`: format all sources with Prettier.
- `npm run typecheck`: type-check TypeScript and Svelte files with `svelte-check`.
- `npm run test:unit`: Vitest unit tests in `tests/unit/`.
- `npm run test:contract`: Vitest contract tests in `tests/contract/` (data files and fixtures
  against the JSON Schema in `contracts/`).
- `npm run test:e2e`: Playwright end-to-end tests in `tests/e2e/` on the `chromium` (1280×800)
  and `mobile` (360×780) projects, against a production build served by `vite preview`. Run
  `npx playwright install chromium` once before the first run.
- `npm run test:e2e:fullstack`: Playwright `@fullstack` tests against a build that talks to a
  local backend on port 7860. It sets `E2E_FULLSTACK=1` and starts the backend with
  `uv run uvicorn` in `../backend`, so it works only once the service exists.
- `npm run gen:api-types`: regenerate `src/generated/api-types.ts` from
  `contracts/inference-api.openapi.yaml`.
- `npm run check:api-types`: fail if the committed API types differ from a fresh generation.
- `npm run check:budgets`: after `npm run build`, check `dist/` against the performance budgets
  below (`scripts/check-budgets.mjs`). It fails if any file under `dist/data/` reaches 300,000
  bytes, or if the initial load reaches 2,000,000 bytes, and prints a table of sizes. The initial
  load counts `index.html`, the entry chunk and its static imports with their CSS, the latin font
  files, `data/examples/index.json` and the default example's `core.json`.
- `npm run lhci`: after `npm run build`, run Lighthouse CI (`lighthouserc.json`) against
  `npm run preview` with the mobile preset and simulated throttling, 3 runs, median. It fails
  unless the performance score is at least 0.9, Largest Contentful Paint at most 3,000 ms, Total
  Blocking Time at most 200 ms and the total byte weight under 2,000,000 bytes (SC-011). It uses
  the locally installed Chrome (set `CHROME_PATH` to use another) and writes reports only to
  `frontend/.lighthouseci/`, never to a public server.

Backend (run from `backend/`):

- `uv run ruff check .`: lint the Python code.
- `uv run pytest`: run the backend tests. Tests marked `model` need the GPT-2 weights; deselect
  them with `uv run pytest -m "not model"`.

## Regenerate example data

The example data under `frontend/public/data/` is generated, never edited by hand. The model is
pinned to one commit of `openai-community/gpt2` by `MODEL_REVISION` in
`backend/app/core/model.py`, the only place it is defined. The generator records it in every data
file. The six example texts and their length categories live in `backend/tools/examples.toml`.

Run from `backend/`, in this order: regenerate, verify, then `--check` (the first run downloads
the pinned GPT-2 weights, about 550 MB, into the Hugging Face cache):

- `uv run python -m tools.generate_examples`: regenerate the example data
  (`frontend/public/data/`), the bundled model config (`frontend/src/generated/gpt2-config.json`),
  the reference parameter shapes (`frontend/tests/reference/param-shapes.json`) and the decoder
  test fixture (`contracts/fixtures/data/tiny-example/`). It fails, and writes nothing, unless
  every example meets the selection rules (token-count band, no trailing `?`, 20 steps or an
  end-of-text stop, a top-1/top-2 probability margin of at least 1e-3 at every step), every file
  is under 300,000 bytes, and every JSON file matches `contracts/example-data.schema.json`.
- `uv run python -m tools.verify_examples`: verify the shipped data against reference GPT-2
  runs (FR-041). For every example and every step it reruns the model on that prefix, through a
  code path independent of the generator, and decodes the shipped files itself (checking each
  SHA-256). It fails on any breach of the tolerances: tokens and top-10 IDs identical,
  probabilities within 1e-4, attention within 1e-3, embeddings and change percentages within
  0.1 % (relative). It prints one line per example and step, then `PASS`.
- `uv run python -m tools.verify_examples --self-test`: corrupt an in-memory copy of the default
  example (one probability, one attention weight, one embedding value, each just beyond its
  tolerance) and fail unless every corruption is detected.
- `uv run python -m tools.generate_examples --check`: regenerate in memory and fail if the
  committed files are stale. Texts, tokens, IDs, shapes, the config and embedding rows must be
  identical; values from matrix multiplications may differ in the last bits between CPUs, so
  probabilities, change percentages and attention are compared with tolerances far below the
  verification tolerances.

## Deploy

**Static site (GitHub Pages).** Every push to `main` runs the `frontend` workflow; its `deploy`
job publishes `frontend/dist` to GitHub Pages only after all frontend check jobs have passed.
One-time setup by the repository owner: in Settings → Pages, set the source to "GitHub
Actions". The build uses `VITE_BASE=/<repository name>/`. Live mode stays hidden, and the site
works fully in example mode, until the repository variable `VITE_API_BASE_URL` (Settings →
Secrets and variables → Actions → Variables) is set to the inference service URL.

**Inference service (Hugging Face Space).** Not set up yet. This section will cover deploying
`backend/` to a Docker Space.

## CI

Two GitHub Actions workflows run on every push and pull request:

- `.github/workflows/frontend.yml`: `static` (ESLint, `svelte-check`, API types up to date),
  `test` (unit tests, including the architecture-literal scan and the README doc check, and
  contract tests), `build` (production build and `check:budgets`), `e2e` (Playwright on the
  `chromium` and `mobile` projects, including the `@a11y` axe suite) and `lighthouse`
  (`npm run lhci`). On `main`, `deploy` publishes to GitHub Pages after all of them pass.
- `.github/workflows/backend.yml`: `checks` runs `ruff check`, `pytest` with all markers (the
  GPT-2 weights are cached under `~/.cache/huggingface`, keyed on `MODEL_REVISION`),
  `tools.generate_examples --check`, `tools.verify_examples` and `tools.verify_examples
  --self-test`.

Changes merge only with both workflows green. The repository owner must protect `main` in
Settings → Branches (or Rules) and mark the check jobs of both workflows as required status
checks: `static`, `test`, `build`, `e2e`, `lighthouse` and `checks`. The workflows cannot set
this up themselves.

## Privacy, budgets and contracts

- **Privacy**: text typed in live mode is sent only in POST request bodies and is never stored
  or logged anywhere: not in files, server or proxy logs, analytics or error reports, and not in
  the URL or browser storage. The site has no accounts and no analytics.
- **Budgets** (checked automatically, values in `contracts/limits.json`): every example data
  file < 300,000 bytes, initial page load < 2,000,000 bytes, and a Lighthouse performance score
  of at least 90 in example mode.
- **Contracts**: the single authoritative contract set is the repo-root `contracts/` directory.
  It holds the OpenAPI description of the inference API, the JSON Schema and binary layouts of
  the example data, the URL-state contract, the shared product limits and test fixtures. Both
  sides test against it.
