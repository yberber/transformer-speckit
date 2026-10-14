# Phase 0 Research: Inside the Transformer

**Feature**: `001-inside-the-transformer` | **Date**: 2026-10-14 | **Plan**: [plan.md](./plan.md)

Each entry: **Decision**, **Rationale**, **Alternatives considered**. Every item that the Technical
Context could have marked "NEEDS CLARIFICATION" is resolved here; none remain open.

---

## R1. Frontend framework and build

- **Decision**: TypeScript 5.x, **Svelte 5** (plain Svelte + **Vite 6**, no SvelteKit), static build
  output (`frontend/dist/`).
- **Rationale**: Eight interactive views share one reactive view state (example, step, layer, head,
  language, theme); a component model avoids hand-written DOM bookkeeping. Svelte compiles to a
  small runtime (~10–15 KB gz for this app's scale), which protects the 2 MB budget and the
  Lighthouse ≥ 90 target. The Svelte compiler emits accessibility warnings at build time, which
  supports Principle VI. Plain Vite (no SvelteKit) because the site is a single page whose
  "routes" are view-state query parameters; SvelteKit's router, SSR and adapters add nothing.
- **Alternatives considered**: Vanilla TS + DOM (smallest, but much more state/DOM glue code for 8
  views and more bug surface); Preact (also small, but needs extra a11y lint setup and a state
  library); React (runtime too heavy for the budget's spirit); SvelteKit with adapter-static
  (unneeded routing/prerender machinery).

## R2. Static hosting and URL scheme

- **Decision**: Host on **GitHub Pages** via a GitHub Actions workflow (the build is also
  host-agnostic: Cloudflare Pages / Netlify work unchanged). All view state lives in the **query
  string** of a single `index.html`; the "How we calculate" formulas are addressed with a fragment
  (`#formula-id`). Contract: [contracts/url-state.md](../../contracts/url-state.md).
- **Rationale**: Query-string state needs no server-side rewrite rules (GitHub Pages has none) and
  is trivially shareable (FR-033). Fragments give stable deep links to individual formulas
  (FR-027, US8-1).
- **Alternatives considered**: Path-based routes (need 404.html redirect hacks on GitHub Pages);
  hash-only state (conflicts with formula anchors).

## R3. Inference service stack

- **Decision**: **Python 3.12**, **FastAPI** + **Uvicorn**, **PyTorch (CPU wheel)** +
  **Hugging Face transformers** (versions pinned in `backend/uv.lock`), packaged as a **Docker
  Space** on Hugging Face Spaces free tier (CPU basic: 2 vCPU, 16 GB RAM; sleeps when idle).
  Model weights for the pinned revision are downloaded **at image build time** so a cold start
  never downloads the model.
- **Rationale**: The spec names Hugging Face transformers as the verification reference
  (FR-041). Running the *same library and code path* for live mode, example generation and
  verification is the most reliable way to meet FR-010 (identical tokens, probabilities within
  1e-4). FastAPI gives typed request/response models with little code. Docker Spaces allow full
  control over the server (logging, CORS, rate limiting) which the Gradio SDK would not.
- **Alternatives considered**: ONNX Runtime (smaller image, but exposing per-head attention and
  per-block intermediates needs custom graph surgery, and results drift from the reference);
  Gradio SDK Space (its own API format, harder to keep a documented contract, logs requests);
  llama.cpp/ggml (quantized, would break tolerances).

## R4. One computation core for live mode and example data

- **Decision**: A single Python module, `backend/app/core/run.py`, computes a **Run** (tokens,
  top-10 predictions per step, per-layer change percentages, attention, embeddings) for a token
  sequence. The service and the example generator (`backend/tools/generate_examples.py`) both call
  it. The frontend consumes one `RunData` interface with two sources: static files (example mode)
  and the API (live mode).
- **Rationale**: FR-009/FR-010 require live and example mode to look and behave the same and to
  give the same numbers. Sharing one computation path and one frontend data interface makes that
  structural rather than a matter of discipline.
- **Alternatives considered**: Separate generator script with its own model code (duplication;
  drift risk); running examples through the live service at build time (makes the static build
  depend on a running server).

## R5. How a Run is computed (causality trick)

- **Decision**: Generation runs greedily one token at a time with the KV cache; the **top-10
  predictions for each step are taken from the same logits that chose the token** (so the marked
  greedy choice always equals the appended token). After generation, **one full forward pass**
  over the final sequence (input + all generated tokens) with forward hooks collects attention
  weights, embeddings and per-block updates for every position. Because GPT-2 is causal, row *i*
  of every per-position quantity depends only on tokens 0..i, so the data for generation step *k*
  is exactly the prefix of length `n_input + k`. Steps are therefore *views* of one Run.
- **Rationale**: Storing one sequence instead of 21 (or 65) separate runs shrinks data ~20× and
  makes "step back" exact and free (FR-007). Taking predictions from the generation loop removes
  a subtle inconsistency (KV-cache vs full-pass logits differ by ~1e-6 and could flip a near-tie).
- **Alternatives considered**: Recomputing every step from scratch (20–64× more compute and
  storage); taking predictions from the full pass (possible mismatch with the appended token).
- **Change percentage capture** (FR-016): hooks on `block.attn` and `block.mlp` outputs.
  `x` = block input; `a` = attention output (after `c_proj`, before residual add);
  `attn_pct = ‖a‖/‖x‖·100`; `y = x + a`; `m` = MLP output; `mlp_pct = ‖m‖/‖y‖·100`. Note: HF
  `output_hidden_states` applies `ln_f` to the last entry, so hidden states are **not** used for
  block 12; hooks are used for all blocks. Model in `eval()` mode (no dropout).

## R6. Example data format and size budget

- **Decision**: Per example, a small JSON **manifest/core file** plus raw little-endian binary
  arrays, each file under 300,000 bytes (raw, uncompressed). Layout:
  - `core.json` (~30–45 KB): text, tokens (id + raw bytes), predictions per step, change
    percentages, file index with dtype/shape/SHA-256 for each binary.
  - `embeddings-token.f32`: token-embedding rows for the example's **unique** token IDs
    (≤ 84 × 768 × 4 = 258,048 B).
  - `attention-L01.u16` … `attention-L12.u16`: one file per layer, all heads, packed causal lower
    triangle, `uint16` quantized with scale 1/65535 (12 × 3,570 × 2 = 85,680 B at 84 tokens).
  - Shared, model-level: `model/wpe-0000-0063.f32`, `model/wpe-0064-0127.f32` — position
    embedding rows 0–127 (196,608 B each), used by **both** modes (positions are the same for every
    text; 128 = live input limit + live step limit).
  - Sum vector (token + position) is computed in the browser (float32 addition, exact to the same
    rounding as the reference).
  Contract: [contracts/example-data.md](../../contracts/example-data.md) +
  [contracts/example-data.schema.json](../../contracts/example-data.schema.json).
- **Rationale**: Sizes from the clarified limits (long example ≤ 64 input + 20 steps = 84 tokens):

  | Data | Naive | Chosen | Tolerance check |
  |---|---|---|---|
  | Attention, all layers | 12·12·84·84·4 B ≈ 4.1 MB | 12 files × 85.7 KB, lazy per layer | uint16 step 1.5e-5 ≪ 0.001 abs |
  | Embeddings (tok+pos+sum) | 3·84·768·4 ≈ 774 KB | 258 KB tok + shared pos, sum computed | float32 exact (0 error) |
  | Probabilities | — | JSON, 7 significant digits | ≤ 5e-8 rel ≪ 1e-4 abs |
  | Change % | — | JSON, 7 significant digits | ≪ 0.1 % rel |

  Float32 is kept for embeddings because float16 (≈0.05 % rel) fails the 0.1 % relative tolerance
  for values below float16's normal range (~6e-5), which do occur in GPT-2 embeddings; bfloat16
  (≈0.4 %) fails outright.
  **"KB" means 1,000 bytes and "MB" 1,000,000 bytes, measured on raw (uncompressed) files.** This
  is stricter than transfer size, independent of host compression, and mechanically checkable.
- **Interpretation recorded**: Principle VII says "each example data file"; this design uses
  **several files per example, each under 300 KB**, loaded lazily by view (the spec explicitly
  allows embeddings to load when the view opens). The initial page load fetches only `core.json`
  of the default example. **Confirmed by the project owner (2026-10-14)**: the 300 KB budget
  applies per file; one example may span several files. See Constitution Check VII in
  [plan.md](./plan.md).
- **Alternatives considered**: One JSON file per example (≥ 1.3 MB even with quantization);
  float16 embeddings (fails tolerance); zip/brotli containers (needs a decompression dependency
  and makes the budget host-dependent); `.npy` files (header parsing for no gain).

## R7. Architecture numbers from the official config

- **Decision**: The generator copies the official `config.json` of the pinned model revision
  (repo `openai-community/gpt2`) verbatim to `frontend/src/generated/gpt2-config.json`; the
  frontend imports it at build time. All shapes, counts, FLOPs and memory figures are computed by
  pure TS functions in `frontend/src/lib/model/` from that config. The generator also writes
  `frontend/tests/reference/param-shapes.json` (name → shape, read from the real `state_dict`,
  buffers excluded) so a unit test proves the config-derived shapes match the actual weights.
- **Config semantics** (from the HF GPT-2 implementation, documented on "How we calculate"):
  `n_inner: null` ⇒ MLP size = 4 × `n_embd`; `n_ctx`/`n_positions` = max context;
  `activation_function: "gelu_new"` ⇒ "GELU (tanh approximation)" label; LM head tied to `wte`.
  The factor 4 and the tying rule are architecture semantics from the official implementation, not
  hand-entered sizes; they are stated as such with a source link.
- **Rationale**: Principle I and FR-001. The shape test turns "derived from config" into a checked
  claim.
- **Alternatives considered**: Fetching config at runtime from the Hub (third-party request on
  every load, breaks offline example mode); hard-coding (forbidden).

## R8. Counting, tokenization and special tokens

- **Decision**: Only the service tokenizes (FR-013). Tokenizer: `GPT2TokenizerFast` of the pinned
  revision, called with **`split_special_tokens=True`** so literal `<|endoftext|>` typed by a user
  is ordinary text (spec edge case). The example generator uses the same call. A test asserts that
  `"<|endoftext|>"` does **not** map to ID 50256. Character cap: 1,000 **Unicode code points**
  (browser: `[...text].length`; service: `len(str)`), enforced on both sides (service as defense).
- **Rationale**: One tokenizer location removes any chance of browser/server disagreement.
- **Alternatives considered**: JS tokenizer in the browser (forbidden by FR-013, plus ~1 MB vocab).

## R9. Token text and partial characters

- **Decision**: Tokens are transported as raw **byte arrays** (GPT-2 byte-level BPE), not strings.
  The frontend decodes each token with `TextDecoder('utf-8', {fatal: true})`; on failure it shows
  the byte values (e.g. `⟨E2 80⟩`) with the "part of a character" explanation. Leading spaces and
  newlines are rendered with visible markers (`␣`, `⏎`) styled subtly.
- **Rationale**: Edge cases "characters split across tokens" and "leading spaces". Strings would
  already have lost information (replacement characters).

## R10. FLOP, parameter and KV-cache formulas (theoretical estimates)

- **Decision**: Implemented once in `frontend/src/lib/model/{params,flops,kvcache}.ts`, used by
  the Cost view, Architecture view and the (interactive) "How we calculate" page. Symbols:
  d = `n_embd`, L = `n_layer`, H = `n_head`, f = MLP size, V = `vocab_size`.
  Convention (from spec Assumptions): forward only, 1 multiply-add = 2 FLOPs, matmuls only;
  bias adds, layer norm, softmax, GELU, residual adds excluded; embedding lookup 0; position add
  shown separately (d per token); causal attention counts only unmasked entries; LM head computed
  only for the position whose next token is predicted.

  | Component (per layer) | Prefill over n tokens | Decode at context length t |
  |---|---|---|
  | QKV projection | 6d²·n | 6d² |
  | Attention scores (QKᵀ) | d·n(n+1) | 2d·t |
  | Attention weighting (A·V) | d·n(n+1) | 2d·t |
  | Output projection | 2d²·n | 2d² |
  | MLP (up + down) | 4d·f·n | 4d·f |
  | **Non-layer** position add | d·n | d |
  | **Non-layer** LM head | 2d·V | 2d·V |

  KV cache bytes(t) = 2 · L · t · d · 4 (float32). Step semantics: prefill(n) yields the step-0
  prediction; the cost shown at step k ≥ 1 is decode(n + k) (processing the token appended at
  step k, producing the step-k prediction); running total = prefill(n) + Σⱼ₌₁..ₖ decode(n + j).

- **Hand-computed GPT-2 small references** (recorded with derivations in
  `frontend/tests/reference/gpt2-small.md`):
  - Parameters: wte 38,597,376; wpe 786,432; per block 7,087,872; 12 blocks 85,054,464;
    ln_f 1,536; **total 124,439,808** (tied LM head counted once) — matches SC-003.
  - Per-layer matmul FLOPs per token = 14,155,776; ×12 = 169,869,312; LM head 77,194,752.
  - decode(1) = 247,101,696; decode(10) = 247,433,472; decode(1024) = 284,813,568.
  - prefill(10) = 1,777,923,072; prefill(64) = 11,025,556,992.
  - KV cache: 73,728 B per token; 75,497,472 B at t = 1024.
- **Rationale**: Principle II / FR-042; a single implementation guarantees the interactive
  formulas "use the same calculations as the rest of the site" (US8-3).
- **Alternatives considered**: Computing estimates in Python and shipping numbers (two
  implementations, the interactive page would need its own copy anyway).

## R11. API contract: format, location, testing

- **Decision**: **OpenAPI 3.1** YAML, path prefix `/api/v1`, `info.version` semver. Large numeric
  arrays travel as an `EncodedArray` object (`dtype`, `shape`, `scale`, base64 little-endian
  `data`) so the same binary decoder serves static files and API responses. Responses are gzip-
  compressed by the service. Shared product limits live in `contracts/limits.json` (input tokens
  64, steps 64, chars 1,000, wait limit 60 s), imported by both sides.
  - **Authoritative location**: repo-root `contracts/` (first implementation task moves the design
    files from `specs/001-inside-the-transformer/contracts/` there and leaves a pointer, so exactly
    one copy exists).
  - **Backend tests**: every endpoint's real responses (success and each error code) are validated
    against the OpenAPI schemas with `jsonschema` (Draft 2020-12, which OpenAPI 3.1 uses); tests
    also assert limits enforcement equals `limits.json`.
  - **Frontend tests**: TS types generated from the YAML with `openapi-typescript` (build fails on
    drift); the API client is tested with `contracts/fixtures/*.json` — fixtures are themselves
    validated against the schema (Ajv) in both test suites, so the frontend never tests against
    an invalid response.
- **Rationale**: Principle IX. Fixtures shared by both suites are the cheapest way to make "tested
  on both sides" mean the same thing on both sides.
- **Alternatives considered**: FastAPI-generated OpenAPI as source of truth (lives in code, not a
  single reviewed file); binary `application/octet-stream` endpoints (not describable/validatable
  in OpenAPI as cleanly); Schemathesis fuzzing (useful, but an extra dependency not required by
  any FR).

## R12. Live-mode request shape (stateless)

- **Decision**: Three model endpoints, all stateless:
  1. `POST /api/v1/runs` `{text, max_new_tokens}` → tokens, predictions per step, change
     percentages for all positions (the "core" of a Run, same shape as `core.json`). The frontend
     always sends `max_new_tokens = limits.max_new_tokens` (64); the user then steps locally.
  2. `POST /api/v1/attention` `{token_ids, layer}` → one layer, all heads (lazy, like example
     files).
  3. `POST /api/v1/token-embeddings` `{token_ids}` → rows for unique IDs (position rows come from
     the shared static files).
  Plus `GET /api/v1/health` (status, model id + revision, API version, limits).
- **Rationale**: No server-side session state (Principle VIII, IV: nothing to retain). Generating
  all 64 steps up front costs ~1–3 s on 2 vCPU (GPT-2 small, KV cache) and gives the same
  step-locally UX as example mode. Detail endpoints take the token ID sequence returned by
  `/runs`, so they never re-tokenize or re-generate.
  `token_ids` length ≤ `max_input_tokens + max_new_tokens` (128), each ID < `vocab_size`.
- **Alternatives considered**: One request per "Next token" (64 round trips, cold-start latency on
  every click); returning everything in one response (≈ 3 MB for 128 tokens).

## R13. Wake-up, timeouts and failure containment

- **Decision**: Entering live mode calls `GET /health` (timeout 5 s per attempt) and polls every
  3 s, cancellable (AbortController). Each attempt is classified as follows:

  | Health attempt result | Reachability probe | Classification |
  |---|---|---|
  | 200 with valid `Health` JSON | — | **ready** |
  | Non-200, non-JSON body (HF "starting" page with CORS headers) or 5 s timeout | — | **waking** |
  | CORS `fetch` rejects (`TypeError`) | `fetch(sameUrl, {mode: 'no-cors', cache: 'no-store'})` resolves (opaque response) | **waking**: the host answered, the browser just may not read it (HF start-up page without CORS headers) |
  | CORS `fetch` rejects | probe also rejects | **unreachable** |

  The UI shows the translated "waking up" status from the first waking attempt. Two
  **consecutive** unreachable attempts (≈ 3–6 s apart in total) end the wait at once with the
  `network` error ("unavailable" + "back to examples"), which meets SC-004's 10 s bound. Any
  waking or ready attempt resets the counter. Otherwise polling continues until
  `limits.wait_limit_s` (60 s) elapses → `wake_timeout` ("unavailable" + link to the Space
  page). Every model request has the same 60 s ceiling.
  The probe is a plain GET of the health URL: it carries no user text or credentials, and its
  opaque body is never read (Principle IV). A deleted or stopped Space still answers through the
  HF proxy, so it shows "waking" and then `wake_timeout`; only a host that cannot be reached at
  all (DNS failure, refused connection, offline client) fails fast.
  Partial bodies are never rendered: responses are parsed only after full receipt and validated
  (shape check) before entering app state. Live-mode code is a lazily-loaded chunk; its errors are
  caught at the mode boundary so example mode keeps working.
  The service compares its model revision with the bundled one; on mismatch the frontend disables
  live mode with a message (prevents silent divergence from example data).
- **Rationale**: FR-011, Principle V, SC-004 (message within 10 s of detected failure).
- **Open item to validate during implementation** (not blocking): whether an HTTP request to the
  Space's `*.hf.space` URL wakes a sleeping free Space, or only a visit to the Space page does,
  and whether the start-up page carries CORS headers (i.e. which "waking" row above is hit).
  The UI behaves correctly in all cases (worst case: "unavailable" after 60 s plus a link to the
  Space page); quickstart step Q8 checks it.
- **Alternatives considered**: Treat every rejected `fetch` as waking (a host that is truly down
  would show "waking" for 60 s, breaking SC-004); treat every rejected `fetch` as unavailable
  (a sleeping Space whose start-up page has no CORS headers would never show "waking" and might
  never be woken). The `no-cors` probe is the only browser-side signal that separates the two.

## R14. Rate limiting and concurrency (≤ 5 concurrent users)

- **Decision**: In-process limiter (~40 lines, no dependency): token bucket per client key
  (first `X-Forwarded-For` hop set by the HF proxy, else socket peer), held in memory only, never
  logged, entries expire after 10 min. Defaults: `/runs` 6/min burst 3; detail endpoints 60/min
  burst 20; `/health` unlimited. Model work runs in a thread pool behind a semaphore of 1
  (`torch.set_num_threads(2)`), with at most 8 waiting requests and a 30 s queue wait; overflow ⇒
  `503 busy` + `Retry-After`. Rate-limit ⇒ `429 rate_limited` + `Retry-After`. All values are
  environment-configurable.
- **Rationale**: "Rate limiting per client" from the constraints; Principle VIII forbids Redis or
  other runtime components; a single process on 2 vCPU serves 5 users if model calls are
  serialized (≈ 1–3 s per run).
- **Alternatives considered**: `slowapi` (pulls `limits`, more than needed); unlimited concurrency
  (thread oversubscription makes every request slow).

## R15. Privacy enforcement (no input stored or logged)

- **Decision**: Uvicorn access log disabled; a tiny middleware logs only
  `method route status duration_ms` (route template, no query, no IP). Custom exception handlers
  return `{error:{code,params}}` and **never echo input** (FastAPI's default 422 echoes `input`;
  replaced). Unexpected exceptions log only the exception class and a request-independent code
  location, not `str(exc)` or locals. Text is POST-body only, never in URLs. Frontend: no
  analytics, no error-reporting service, live text never written to `localStorage`/URL/IndexedDB.
  **Tests**: a "canary" test sends a unique string through every endpoint and error path and
  asserts it appears in no captured log record (backend) and in no storage/URL (e2e).
- **Rationale**: Principle IV, FR-012, Quality Gate 4. Operational counts/latencies remain allowed.

## R16. Internationalization

- **Decision**: Hand-rolled i18n: `frontend/src/lib/i18n/{en,tr,de}.json` flat key catalogs;
  TypeScript key type derived from `en.json`; `Intl.PluralRules` / `Intl.NumberFormat` per locale;
  non-default locales lazy-loaded. Glossary terms are a separate catalog
  (`glossary.{en,tr,de}.json`) keyed by term id; a `<Term>` component renders the English term and
  its explanation in the UI language at first appearance per view. A unit test fails if any key is
  missing/empty in any locale, or if any glossary term is translated (term text must stay
  English). Error codes from the service are translated in the frontend.
- **Rationale**: Three locales and simple messages don't justify an i18n library; the
  completeness test enforces SC-008 directly.
- **Alternatives considered**: `svelte-i18n` / `i18next` (runtime cost; completeness checks still
  needed).

## R17. Visualizations, accessibility and motion

- **Decision**:
  - **Heatmap**: `<canvas>` drawing + one focusable grid widget with a roving active cell
    (arrow keys/Home/End), an `aria-live="polite"` readout ("from ‘ cat’ to ‘The’: 0.412"), and an
    equivalent `<table>` under "Show as table" (FR-038). Focused mode (single row / ranked list)
    when cells would be < 10 CSS px (narrow screens, long contexts).
  - **Embedding strips**: canvas, one strip per vector (all `n_embd` values, diverging color
    scale); "Show details" opens a virtualized table for the selected token (all dimensions).
  - **Architecture diagram and context-length chart**: inline SVG, hand-written (one line chart
    does not justify a charting library).
  - **Token colors**: position-based palette tested for WCAG AA (≥ 4.5:1) text contrast in both
    themes; every token also carries its position/text label (color never sole cue).
  - **Motion**: Svelte transitions with durations from a `motion` store bound to
    `prefers-reduced-motion`; reduced ⇒ duration 0, same final state.
  - **Checks**: Playwright + `@axe-core/playwright` on every main view × 2 themes × 3 languages;
    keyboard-only e2e paths for all FR-043 scenarios.
- **Alternatives considered**: SVG heatmap (≤ 8,256 cells per head in live mode; too many DOM
  nodes for mid-range phones); D3 (≈ 80 KB for features we use twice).

## R18. Testing toolchain

- **Decision**:
  - Frontend: **Vitest** (unit, contract, i18n completeness, palette contrast, budgets helpers),
    **Playwright** (e2e, keyboard, axe), **Lighthouse CI** (`@lhci/cli`, mobile preset with
    simulated throttling: performance ≥ 0.90, `largest-contentful-paint` ≤ 3,000 ms and
    `total-blocking-time` ≤ 200 ms as the measurable form of SC-011's "first usable view within
    3 s", total byte weight < 2,000,000), `svelte-check` + ESLint for static checks. No DOM
    emulator (jsdom): rune-based state is tested in Vitest's `node` environment and components
    only in a real browser.
  - Backend: **pytest** + FastAPI `TestClient` (contract, limits, rate limit, privacy canary,
    live-vs-example equality SC-002 using the real model), **ruff**.
  - Data: `backend/tools/verify_examples.py` — reruns the HF reference **step by step** (prefix of
    length n+k for every k; independent code path from the generator's single full pass), decodes
    the shipped files independently, and fails on any tolerance breach (FR-041).
  - Budgets: `frontend/scripts/check-budgets.mjs` — every file under `public/data/` and
    `public/model/` < 300,000 B; initial-load set (Vite manifest entry graph + fonts + default
    `core.json`) < 2,000,000 B.
  - E2E live mode: default runs use Playwright route mocks fed by contract fixtures (fast,
    deterministic); one `@fullstack` project runs the live scenarios against a locally started
    backend in a separate CI job with a cached model.
  - **When the gates start**: CI (both workflows), the budget check, Lighthouse CI, the axe suite
    and the README doc check are set up at the end of the foundational phase, before any user
    story. The axe suite iterates over every view that is no longer a placeholder, so each view
    is covered from the moment it is built. `main` is protected by these checks, and the Pages
    deploy job runs only after they pass, so no deploy (including the MVP) skips them.
- **Rationale**: FR-041–FR-044, SC-001–SC-012, Principles II, VI, VII, IX. Principles VI and VII
  require automated checks and forbid merging a budget break; adding CI only at the end would
  let the MVP deploy without them.

## R19. Python tooling and repository layout

- **Decision**: One Python project `backend/` managed with **uv** (`pyproject.toml` + `uv.lock`),
  containing the service (`app/`) and offline tools (`tools/generate_examples.py`,
  `tools/verify_examples.py`). The Docker image installs only runtime deps. Example texts and their
  length bands live in `backend/tools/examples.toml`; example titles (UI strings) live in the i18n
  catalogs.
- **Rationale**: The generator must share `app/core/run.py` (R4); one project avoids a workspace.
- **Alternatives considered**: Separate `pipeline/` project (duplicated deps or cross-project
  imports); pip + requirements.txt (no lockfile, weaker reproducibility of reference numbers).

## R20. Example selection rules (enforced by the generator)

- **Decision**: The generator fails unless every example: is English text to continue (not a
  question; no trailing `?`); has input token count within its band (short 5–15, medium 20–35,
  long 50–64); produces 20 steps or stops at EOS; has a **top-1 vs top-2 probability margin
  ≥ 1e-3 at every step** (guards against greedy near-ties that could flip across CPUs and break
  FR-010); and yields every file < 300,000 B. It records library versions, model revision and file
  hashes in `core.json`.
- **Rationale**: FR-003, FR-005, FR-010, Principle VII; reproducibility of SC-001.

## R21. Deployment

- **Decision**:
  - Frontend: GitHub Actions builds, runs budgets, axe and Lighthouse checks, and deploys
    `frontend/dist` to GitHub Pages only after every check passes.
    `VITE_API_BASE_URL` set at build time (empty ⇒ live mode hidden, site fully works).
  - Backend: `backend/` contains the Space's `Dockerfile` and Space `README.md` front matter
    (`sdk: docker`, `app_port: 7860`). Deploy by `huggingface_hub` `upload_folder` (CI job or
    manual command in README). `ALLOWED_ORIGINS` env var configures CORS to the Pages origin.
- **Rationale**: Free tiers on both sides; site works with no backend (Principle V).
