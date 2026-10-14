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

Backend: the inference service entry point does not exist yet. Its `uvicorn` command is added
here when the service is built.

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
- `npm run check:budgets`: check the built `dist/` against the performance budgets below
  (`scripts/check-budgets.mjs`, not written yet).
- `npm run lhci`: run Lighthouse CI against the preview build (its config,
  `lighthouserc.json`, is not written yet).

Backend (run from `backend/`):

- `uv run ruff check .`: lint the Python code.
- `uv run pytest`: run the backend tests. Tests marked `model` need the GPT-2 weights; deselect
  them with `uv run pytest -m "not model"`.

## Regenerate example data

The example-data generator and verifier do not exist yet. This section will list their commands
and say where the model revision is pinned.

## Deploy

Deployment is not set up yet. This section will cover publishing the static site to GitHub
Pages and the inference service to a Hugging Face Space.

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
