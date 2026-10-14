# Implementation Plan: Inside the Transformer

**Branch**: `001-inside-the-transformer` (spec directory; work currently on `main`) | **Date**: 2026-10-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-inside-the-transformer/spec.md` + Part B technical
constraints (static TS frontend, CPU-only service on HF Spaces free tier, ≤ 5 concurrent users,
documented and two-side-tested API contract, live limits 64/64 with per-client rate limiting,
2 MB / 300 KB budgets, architecture numbers only from the official config, regeneration script,
README).

## Summary

A static Svelte + TypeScript site shows GPT-2 small turning text into new text, one token at a
time, with real numbers. **Example mode** (default) reads six precomputed runs shipped as small
JSON + raw binary files and never calls a server. **Live mode** calls one stateless FastAPI +
PyTorch (CPU) service on Hugging Face Spaces that tokenizes, generates greedily and returns data
in the **same Run shape** as the example files.

Key technical approach (details in [research.md](./research.md)):

- **One computation core** (`backend/app/core/run.py`) produces both example data (offline
  generator) and live responses, so FR-010 parity is structural (R4).
- **A run is one sequence; steps are prefixes.** Because GPT-2 is causal, one full forward pass
  over the final sequence yields attention, embeddings and change percentages for every step;
  predictions come from the generation loop's own logits (R5).
- **Budget-driven data layout**: per example a ~40 KB `core.json` (loaded first), a float32
  token-embedding file and 12 per-layer uint16 attention files (all < 300 KB, lazy); shared
  position-embedding shards (R6).
- **All architecture numbers** are computed in TS from the verbatim official `config.json`; a test
  proves config-derived shapes equal the real `state_dict` shapes (R7). Estimates use one TS
  implementation of documented formulas, tested against hand-computed references (R10).
- **Contract** (OpenAPI 3.1 + JSON Schema + shared fixtures + `limits.json`) tested by `jsonschema`
  on the backend and by generated types + Ajv-validated fixtures on the frontend (R11).

## Technical Context

**Language/Version**: TypeScript 5.x (frontend, Node 22 LTS toolchain); Python 3.12 (service,
generator, verifier)

**Primary Dependencies**: Frontend — Svelte 5, Vite 6 (runtime: Svelte only). Backend — FastAPI,
Uvicorn, Pydantic v2, PyTorch (CPU wheel), Hugging Face transformers; versions pinned in
`frontend/package-lock.json` and `backend/uv.lock`. Model: `openai-community/gpt2` at a pinned
commit SHA. Full list with justifications: [Dependency justification](#dependency-justification-principle-viii).

**Storage**: None at runtime. Example data = static files committed under `frontend/public/data/`
(≈ 8–9 MB total, every file < 300 KB). Browser `localStorage` only for language and theme
preferences. No database (Principle VIII).

**Testing**: Vitest (unit, contract, i18n completeness, color contrast), Playwright +
@axe-core/playwright (e2e, keyboard, a11y), Lighthouse CI (performance, byte weight), pytest +
FastAPI TestClient + jsonschema (backend contract, limits, rate limits, privacy canary,
live-vs-example parity), `tools/verify_examples.py` (reference tolerances).

**Target Platform**: Evergreen browsers (last 2 versions of Chrome, Firefox, Safari, Edge; iOS
Safari, Android Chrome) from 360 px wide; static hosting on GitHub Pages. Service: Docker Space on
HF Spaces free CPU tier (2 vCPU, 16 GB RAM, sleeps when idle).

**Project Type**: Web application — static frontend + one inference web service.

**Performance Goals**: Lighthouse performance ≥ 90 (mobile preset) in example mode; first usable
view ≤ 3 s on mid-range phone over 4G, measured in the same Lighthouse mobile run as Largest
Contentful Paint ≤ 3,000 ms and Total Blocking Time ≤ 200 ms (SC-011); view switches and step changes < 100 ms (all data local
after first load of a view); live `/runs` for 64 input + 64 steps ≈ 1–3 s on 2 vCPU; ≤ 5
concurrent users.

**Constraints**: Initial load < 2,000,000 B; each data file < 300,000 B (raw bytes); live limits
64 input tokens / 64 steps / 1,000 chars; 60 s wait limit incl. wake-up; per-client rate limits;
CPU only; no stored/logged user text; tolerances: probs 1e-4 abs, attention 1e-3 abs, vectors
0.1 % rel.

**Scale/Scope**: 1 model, 6 examples × ≤ 21 steps, 8 views (tokens, embeddings, blocks, attention,
prediction, architecture, cost, how-we-calculate), 3 locales, ≈ 300–400 UI strings, 4 API
endpoints.

No "NEEDS CLARIFICATION" items remain; all were resolved in [research.md](./research.md).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status (pre-research) | How the design satisfies it (post-design re-check) |
|---|---|---|---|
| I | Accuracy over Appearance | ✅ PASS | Every number is one of: model output (example files from the reference model; live service), derived from the bundled verbatim `config.json` (`lib/model/*`), or a labelled estimate linking to its formula (`CostEstimate.is_estimate`, `formula_id`). No architecture literals: ESLint `no-restricted-syntax` rule + a unit test grep for 768/3072/50257/1024/124439808 outside `tests/reference/` and generated files. Shape test against real `state_dict` (R7). |
| II | Verified Calculations | ✅ PASS | `lib/model/{params,flops,kvcache}.ts` tested against `tests/reference/gpt2-small.md` (hand derivations recorded next to values, R10). `verify_examples.py` checks all example data against per-step HF reference runs with documented tolerances and fails on breach (R18). Estimates without passing tests are not rendered (Cost view reads only from the tested module). |
| III | Built for Non-Experts | ✅ PASS | One-sentence explanation per view; "Show details" disclosure for exact numbers; `<Term>` component keeps 12+ glossary terms in English with localized explanation at first appearance per view; en/tr/de catalogs with a completeness test that fails CI (R16). |
| IV | Privacy by Default | ✅ PASS | Text only in POST bodies; no access log; route-template-only request log; no input echo in errors; no analytics or error reporting; live text never in URL/storage; canary tests on both sides (R15). |
| V | Always Usable | ✅ PASS | Example mode = static files, no server, no model download; site builds and works with `VITE_API_BASE_URL` unset. Live mode is a lazy chunk behind an error boundary; wake-up, timeout, busy and error states are translated and offer "back to examples"; e2e runs with service down (R13). |
| VI | Accessible | ✅ PASS | Keyboard grid widget for heatmap, roving focus, live-region readouts, table equivalents for heatmap/vectors/chart; visible focus; reduced-motion support; axe on every main view × 2 themes × 3 locales in CI (R17). The axe suite and CI exist from the end of the foundational phase and cover each view as soon as it is built, so no view ships, including the MVP deploy, without passing them (R18). |
| VII | Performance Budgets | ✅ PASS | `check-budgets.mjs` + Lighthouse CI (score ≥ 90, LCP ≤ 3,000 ms, TBT ≤ 200 ms, byte weight) run in CI from the end of the foundational phase; `main` is protected by these checks and the Pages deploy runs only after they pass. An example's data is split into several files, *each* < 300,000 B, loaded lazily per view; only `index.json` + default `core.json` are in the initial load (R6). **Confirmed by the project owner (2026-10-14)**: the budget applies per file, and one example may span several files. |
| VIII | Simplicity | ✅ PASS | Exactly two runtime components (static site + one CPU service). No DB, queue, cache, auth or accounts. Rate limiter and concurrency gate in-process (~40 lines). Every dependency justified below. |
| IX | Documented Contracts | ✅ PASS | Single authoritative contract set at repo-root `contracts/` (moved from this spec folder in the first task): OpenAPI 3.1, JSON Schema for data files, `limits.json`, URL-state contract, shared fixtures. Backend validates real responses; frontend uses generated types and fixture-driven client tests (R11). README covers run/test/deploy/regenerate. It is created in the setup phase and every task that adds or changes a run, test, deploy or regeneration command updates it in the same task. From the foundational phase, a CI doc check fails if the README misses any `frontend/package.json` script or `backend/tools` / `app` entry point; before release the check also covers every command in `quickstart.md`. |

**Gate result**: PASS — no violations; Complexity Tracking is empty. The per-file reading of
the VII budget was confirmed by the project owner on 2026-10-14.

### Dependency justification (Principle VIII)

| Dependency | Side | Concrete requirement it serves | Why existing tools are not enough |
|---|---|---|---|
| Svelte 5 | FE runtime | 8 interactive views sharing reactive state; compile-time a11y warnings (FR-038) | Hand-written DOM updates for heatmaps, steppers, i18n re-render = more code and bugs; Svelte's runtime is small (budget) |
| Vite 6, @sveltejs/vite-plugin-svelte | FE build | TS + Svelte compilation, code splitting (lazy views, lazy live mode), static output | No build = no TS/Svelte; Vite is the standard Svelte toolchain and the plugin is how Vite compiles `.svelte` and `.svelte.ts` files |
| TypeScript 5 | FE dev | Typed config, contract types and calculation code (Principles I, II, IX) | Plain JS cannot type-check generated API types or the data layer |
| Vitest | FE test | FR-042 calculation tests, i18n/contract/palette tests, rune-based state tests (`.svelte.ts` compiled by the Svelte plugin in the `node` environment) | Shares Vite config; no other runner needed. No DOM emulator (e.g. jsdom) is added: there are no component unit tests, and components are tested in a real browser by Playwright |
| Playwright + @axe-core/playwright | FE test | FR-043 e2e, FR-044/SC-007 a11y checks, keyboard scenarios | Only practical way to automate browser + axe |
| @lhci/cli | FE CI | Principle VII Lighthouse ≥ 90, SC-011 LCP/TBT and byte budget checked automatically | Constitution requires automated check |
| openapi-typescript | FE dev | Principle IX: TS types generated from the OpenAPI contract | Hand-written types would drift silently |
| Ajv | FE dev (tests only) | Principle IX: validate fixtures and committed example data against the JSON Schema (Draft 2020-12) | Never shipped to the browser (runtime uses hand-written guards). `ajv-formats` is not added: the contract schemas use no `format` keywords |
| svelte-check | FE dev | Type checking `.svelte` files | `tsc` does not understand `.svelte` files |
| @types/node (^22, matching the Node 22 toolchain) | FE dev | Type checking the tests and scripts that read committed files with Node APIs (`node:fs`, `node:crypto`): fixture decoding, contract/budget/README/architecture-literal checks | Already installed by `@lhci/cli`, but at an unrelated major version; declared explicitly because our tests import Node APIs directly, so the version is locked rather than inherited by accident |
| ESLint, typescript-eslint, eslint-plugin-svelte | FE dev | Architecture-literal lint rule over `.ts` and `.svelte` (Principle I) | ESLint cannot parse TS or Svelte without these two plugins |
| Prettier, prettier-plugin-svelte | FE dev | Consistent formatting, including `.svelte` files | Prettier cannot format Svelte without the plugin |
| Self-hosted fonts (1 sans, 1 mono, latin + latin-ext woff2) | FE asset | FR-040 polished design; Turkish/German glyphs | System fonts vary widely; third-party font CDN would leak visitor IPs |
| FastAPI, Uvicorn, Pydantic v2 | BE runtime | Typed HTTP API with validation (Principle IX) | Standard library HTTP server lacks validation, async, CORS |
| PyTorch (CPU), transformers | BE runtime + tools | Reference model (FR-041 names HF transformers); attention/hooks access | Any other runtime breaks parity with the reference |
| NumPy | BE runtime + tools | Attention packing and uint16 quantization (`encode.py`), little-endian binary writing, and the verifier's independent decoding of shipped files (FR-041) | Already installed by PyTorch and transformers; declared explicitly because our code imports it directly, so the version is locked rather than inherited by accident |
| huggingface_hub | BE runtime + tools | Downloading the pinned model snapshot for the Docker image (`app.core.model --download`), reading the pinned `config.json` for the generator, and uploading the Space (`deploy_space.py`) | Already installed by transformers; declared explicitly because our code imports it directly. A hand-written HTTP client for the Hub API would duplicate it |
| jsonschema, referencing | BE dev | Contract validation (Principle IX); `referencing` resolves the OpenAPI file's external `$ref` to `example-data.schema.json` | `referencing` is the registry library `jsonschema` itself uses; declared explicitly because the tests import it directly |
| PyYAML | BE dev | Loading `inference-api.openapi.yaml` in the contract tests | The standard library has no YAML parser; the contract is authored in YAML |
| pytest, httpx (TestClient), ruff | BE dev | Tests, FastAPI TestClient transport, lint | — |
| uv | BE tooling | Locked, reproducible env so example data regenerates identically | pip lacks a lockfile |

Explicitly **not** added: i18n library, charting library (D3), state library, rate-limit
library, Redis/DB, analytics, error-reporting SaaS, SvelteKit, jsdom/happy-dom, ajv-formats.

Any task that adds a dependency not in this table MUST first add a row here (Principle VIII).

## Project Structure

### Documentation (this feature)

```text
specs/001-inside-the-transformer/
├── plan.md              # This file
├── research.md          # Phase 0 output — decisions R1–R21
├── data-model.md        # Phase 1 output — entities, invariants, validation
├── quickstart.md        # Phase 1 output — validation scenarios Q1–Q12
├── contracts/           # Phase 1 output — moves to repo-root contracts/ in the first task
│   ├── inference-api.openapi.yaml
│   ├── example-data.schema.json
│   ├── example-data.md
│   ├── url-state.md
│   └── limits.json
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
contracts/                         # AUTHORITATIVE, versioned (Principle IX)
├── inference-api.openapi.yaml
├── example-data.schema.json
├── example-data.md
├── url-state.md
├── limits.json
└── fixtures/                      # shared request/response + data fixtures, schema-validated
    ├── api/{health,run,attention,token-embeddings,error-*}.json
    └── data/tiny-example/          # small core.json + binaries for frontend decoder tests

frontend/
├── index.html
├── package.json / package-lock.json / vite.config.ts / tsconfig.json / playwright.config.ts / lighthouserc.json
├── public/
│   ├── fonts/
│   └── data/                      # GENERATED by backend/tools/generate_examples.py (committed)
│       ├── examples/index.json, <id>/core.json, embeddings-token.f32, attention-LNN.u16
│       └── model/wpe-0000-0063.f32, wpe-0064-0127.f32
├── scripts/
│   └── check-budgets.mjs
├── src/
│   ├── main.ts, App.svelte
│   ├── generated/                 # GENERATED: gpt2-config.json, api-types.ts (openapi-typescript)
│   ├── lib/
│   │   ├── model/                 # config.ts, params.ts, flops.ts, kvcache.ts (pure, tested)
│   │   ├── data/                  # binary.ts, runData.ts, exampleSource.ts, liveSource.ts
│   │   ├── api/                   # client.ts (timeouts, wake-up, error codes)
│   │   ├── state/                 # viewState.svelte.ts, url.ts
│   │   ├── i18n/                  # index.ts, en.json, tr.json, de.json, glossary.{en,tr,de}.json
│   │   ├── tokens/                # display.ts (bytes → text/markers), palette.ts
│   │   └── motion.ts
│   ├── components/                # Term, ShowDetails, Stepper, TokenChip, Heatmap, VectorStrip, FlowIndicator, ...
│   └── views/                     # Tokens, Embeddings, Blocks, Attention, Prediction, Architecture, Cost, Method
└── tests/
    ├── unit/                      # model/, data/, i18n/, url/, palette/, tokens/
    ├── contract/                  # fixtures valid vs schema; client handles each response/error
    ├── reference/                 # gpt2-small.md (hand derivations), param-shapes.json (GENERATED)
    └── e2e/                       # FR-043 scenarios, @a11y, @keyboard, @i18n, @share, @privacy, @live, @fullstack

backend/
├── pyproject.toml / uv.lock
├── Dockerfile                     # python:3.12-slim + CPU torch; bakes pinned model weights
├── README.md                      # HF Space card front matter (sdk: docker, app_port: 7860)
├── app/
│   ├── main.py                    # FastAPI app, CORS, gzip, lifespan (load model once)
│   ├── api.py                     # 4 endpoints
│   ├── schemas.py                 # Pydantic models mirroring the contract
│   ├── errors.py                  # error codes, no-echo handlers
│   ├── limits.py                  # loads contracts/limits.json (copied into image)
│   ├── ratelimit.py               # in-memory token buckets + concurrency gate
│   ├── logging.py                 # route-template-only request log
│   └── core/
│       ├── model.py               # load pinned tokenizer/model, eval mode, thread settings
│       ├── run.py                 # SHARED: generate + full pass with hooks → Run
│       └── encode.py              # EncodedArray / binary writers (attention packing, quantization)
├── tools/
│   ├── examples.toml              # six example texts + length bands
│   ├── generate_examples.py       # writes frontend/public/data, src/generated, tests/reference/param-shapes.json
│   ├── verify_examples.py         # independent per-step HF reference check (FR-041)
│   └── deploy_space.py            # huggingface_hub upload_folder
└── tests/
    ├── contract/                  # responses validate against contracts/*.yaml|json
    ├── unit/                      # tokenizer special-token rule, encode/packing, ratelimit, errors
    ├── integration/               # test_live_matches_examples.py (SC-002), limits enforcement
    └── privacy/                   # canary never logged or echoed

.github/workflows/
├── frontend.yml                   # created in the foundational phase: lint, typecheck, unit, contract, doc check, build, budgets, axe, lighthouse, deploy Pages (after all checks); later phases add the remaining e2e projects
├── backend.yml                    # created in the foundational phase: ruff, pytest (model cached), generate --check, verify_examples; fullstack e2e added with live mode
└── space-deploy.yml               # manual: deploy backend/ to HF Space

README.md                          # run, test, deploy, regenerate example data (Principle IX)
```

**Structure Decision**: Web application with `frontend/` and `backend/` plus a repo-root
`contracts/` directory that both sides read (single authoritative contract). The offline
generator and verifier live inside `backend/` because they must share `app/core/run.py` with the
service (R4, R19). Generated artifacts (example data, bundled config, reference shapes, API types)
are committed and regenerated only by scripts.

## Phase 0 → Phase 1 outputs

- [research.md](./research.md): 21 decisions (stack, data layout and budgets, formulas with
  hand-computed references, contract strategy, live-mode protocol, wake-up, rate limiting,
  privacy, i18n, a11y, testing, deployment).
- [data-model.md](./data-model.md): ModelConfig, Limits, Example, Run, Token, GenerationStep,
  Prediction, LayerSnapshot, EmbeddingVectors, ParamGroup, CostEstimate, ViewState, GlossaryTerm,
  Locale catalog, ApiError.
- [contracts/](../../contracts/): `inference-api.openapi.yaml`, `example-data.schema.json`,
  `example-data.md`, `url-state.md`, `limits.json`.
- [quickstart.md](./quickstart.md): validation scenarios Q1–Q12 mapped to stories, FRs and SCs.

Agent context file: none configured for this project (no `update-agent-context` script in
`.specify/scripts/`), so none was updated.

## Risks & follow-ups for `/speckit-tasks`

1. **Wake-up semantics** of sleeping free Spaces via API requests — validated in quickstart Q8;
   UI is correct either way (R13). The HF start-up page is cross-origin and may lack CORS headers,
   which makes a CORS `fetch` fail exactly like an unreachable host; R13 resolves this with a
   second, `no-cors` reachability probe (an opaque response proves the host answered).
2. **CPU-to-CPU numeric drift** could flip greedy near-ties between the generator machine and the
   Space — mitigated by the ≥ 1e-3 top-1/top-2 margin rule for examples (R20); live parity test
   SC-002 runs in CI.
3. **Model revision pin**: the first backend task resolves and records the current commit SHA of
   `openai-community/gpt2` in one place (`backend/app/core/model.py` constant, mirrored into
   generated data); never "main".
4. **Usability study SC-005** needs 5 participants — a manual activity, to be listed as a
   release task, not automatable.

## Complexity Tracking

> No Constitution Check violations. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
