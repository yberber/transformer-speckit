---

description: "Task list for implementing Inside the Transformer"
---

# Tasks: Inside the Transformer

**Input**: Design documents from `specs/001-inside-the-transformer/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R21), data-model.md, contracts/, quickstart.md (Q1–Q12)

**Tests**: REQUIRED. The spec asks for them explicitly (FR-041 reference verification, FR-042 calculation tests, FR-043 end-to-end tests, FR-044 accessibility checks), and the constitution requires them (Principles II, VI and IX). Within each story, write the test tasks first and confirm they fail before you implement.

**Organization**: Tasks are grouped by user story, so each story can be built and checked as its own increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: The user story the task belongs to (US1–US8)
- Every task names exact file paths
- Tasks with a letter suffix (T008a, T049a–T049d) were inserted after the list was numbered (analysis remediation). They run in the position where they appear, and the existing IDs and cross-references are unchanged.

## Path Conventions

Web application (plan.md → Project Structure): `frontend/`, `backend/`, the authoritative `contracts/` at the repo root, and `.github/workflows/`. "Config" always means `frontend/src/generated/gpt2-config.json` (frontend) or the pinned HF config (backend). **Never write architecture numbers (768, 3072, 50257, 1024, 12 layers/heads, 124439808) as literals in application code** (Principle I). These numbers may appear only in `frontend/tests/reference/` and generated files.

**README rule (Principle IX)**: any task that adds or changes a run, test, deploy or regeneration command (an `npm run` script, a `uv run` / `python -m` entry point, an env var needed to run or deploy) MUST update the root `README.md` in the same task. From T049a on, the doc check fails CI when it does not.

**Dependency rule (Principle VIII)**: any task that adds a dependency not listed in plan.md → "Dependency justification" MUST add a row there first.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Repository layout, toolchains and the single authoritative contract location

- [X] T001 Move the contract set to the repo root: `git mv specs/001-inside-the-transformer/contracts/{inference-api.openapi.yaml,example-data.schema.json,example-data.md,url-state.md,limits.json} contracts/`. Create `specs/001-inside-the-transformer/contracts/README.md`, a one-paragraph pointer saying the authoritative copy is `../../../contracts/`. Update the `contracts/` links in `specs/001-inside-the-transformer/{plan,research,data-model,quickstart}.md` to `../../contracts/…`. Keep the relative `$ref: "./example-data.schema.json"` inside the OpenAPI file unchanged, because both files move together.
- [X] T002 Create the directory skeleton from plan.md: `contracts/fixtures/api/`, `contracts/fixtures/data/tiny-example/`, `frontend/{public/fonts,public/data/examples,public/data/model,scripts,src/generated,src/lib/{model,data,api,state,i18n,tokens},src/components,src/views,src/styles,tests/{unit,contract,reference,e2e}}`, `backend/{app/core,tools,tests/{contract,unit,integration,privacy}}` (add `__init__.py` in `backend/app`, `backend/app/core`, `backend/tools`, `backend/tests`), and `.github/workflows/`
- [ ] T003 Initialize the Python project in `backend/pyproject.toml` with uv. Use Python `==3.12.*`. Runtime deps: `fastapi`, `uvicorn[standard]`, `pydantic>=2`, `torch` (CPU wheel via `[tool.uv.sources]` + index `https://download.pytorch.org/whl/cpu`), `transformers`, `numpy` and `huggingface_hub` (both imported directly by our code; see plan.md dependency table). Dev group: `pytest`, `httpx`, `jsonschema`, `referencing`, `pyyaml`, `ruff`. Every package here has a row in plan.md → "Dependency justification". Configure `[tool.ruff]` (line length 100, rules E,F,I,UP,B) and `[tool.pytest.ini_options]` (testpaths `tests`, marker `model` = "needs GPT-2 weights"). Run `uv lock` and commit `backend/uv.lock`.
- [ ] T004 Initialize the frontend in `frontend/package.json` (Node 22, `"type": "module"`). Runtime dep: `svelte@^5`. Dev deps: `vite@^6`, `@sveltejs/vite-plugin-svelte`, `typescript@^5`, `svelte-check`, `vitest`, `@playwright/test`, `@axe-core/playwright`, `@lhci/cli`, `openapi-typescript`, `ajv`, `eslint`, `typescript-eslint`, `eslint-plugin-svelte`, `prettier`, `prettier-plugin-svelte`. Add the scripts `dev`, `build`, `preview`, `typecheck` (svelte-check), `lint`, `format`, `test:unit`, `test:contract`, `test:e2e`, `test:e2e:fullstack`, `gen:api-types`, `check:api-types`, `check:budgets`, `lhci`. Create `frontend/vite.config.ts`: Svelte plugin, `base` from `process.env.VITE_BASE ?? '/'`, alias `$contracts` → `../contracts`, `server.fs.allow: ['..']`, `build.manifest: true`. Create `frontend/tsconfig.json` with `strict` and `resolveJsonModule`, and `frontend/index.html` with `<html lang="en">`. Commit `package-lock.json`.
- [ ] T005 [P] Configure linting in `frontend/eslint.config.js` (typescript-eslint + eslint-plugin-svelte) and `frontend/.prettierrc`. Add a `no-restricted-syntax` rule that rejects the numeric literals `768`, `3072`, `50257`, `1024` and `124439808` in `src/**` except `src/generated/**`, with the message "Architecture numbers must come from the model config (Principle I)".
- [ ] T006 [P] Configure test runners. `frontend/vitest.config.ts` has projects `unit` (`tests/unit/**`) and `contract` (`tests/contract/**`), environment `node` for both, with the Svelte plugin loaded so rune-based `.svelte.ts` modules compile. Do not add jsdom or another DOM emulator: components are tested only in Playwright (plan.md dependency table). `frontend/playwright.config.ts` has projects `chromium` (desktop 1280×800), `mobile` (360×780, `isMobile`) and `fullstack` (grep `@fullstack`, with a second `webServer` running `uv run uvicorn app.main:app --port 7860 --no-access-log` in `../backend`). The default `webServer` is `npm run build && npm run preview -- --port 4173`, and `fullstack` is excluded from the default projects.
- [ ] T007 [P] Create the root `.gitignore` (node_modules, dist, .venv, __pycache__, playwright-report, test-results, .lighthouseci, `.cache/huggingface`) and `.editorconfig`
- [ ] T008 [P] Add self-hosted fonts: one sans and one monospace font (e.g. Inter + JetBrains Mono, both OFL), as woff2 subset to latin + latin-ext (Turkish/German glyphs), in `frontend/public/fonts/`, with the license files beside them. Declare them with `@font-face` and `font-display: swap` in `frontend/src/styles/fonts.css`. No third-party font CDN.
- [ ] T008a Create the root `README.md` skeleton (Principle IX, after T003 and T004). Sections: overview and the two components; prerequisites (Node 22, Python 3.12, uv, optional Docker); run locally; test; regenerate example data; deploy; privacy guarantees, budgets and the `contracts/` location. Fill in every command that exists now: `uv sync`, `npm ci` and each script defined in `frontend/package.json` by T004 with one line saying what it does. Sections whose commands do not exist yet say so in one line. From here on the README rule (Path Conventions) applies.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared computation core, generated example data, the data layer, i18n, view state and the app shell. Every story needs these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Backend computation core and example data (R4, R5, R6, R8, R20)

- [ ] T009 Implement `backend/app/core/model.py`. Constants `MODEL_ID = "openai-community/gpt2"` and `MODEL_REVISION`: resolve the current 40-hex commit SHA once with `huggingface_hub.HfApi().model_info(MODEL_ID).sha` and hard-code it here (never "main"; this is the only place it is defined). `load()` → `(tokenizer, model)` using `GPT2TokenizerFast` and `GPT2LMHeadModel.from_pretrained(..., revision=MODEL_REVISION, attn_implementation="eager", torch_dtype=torch.float32)`, `model.eval()`, `torch.set_num_threads(int(os.environ.get("TORCH_THREADS", "2")))`, cached as a module singleton. Also add `tokenize(text) -> list[int]` using `tokenizer(text, split_special_tokens=True)["input_ids"]`, `token_bytes(id) -> bytes` (via `convert_ids_to_tokens` + the byte-level BPE `byte_decoder`), `eos_token_id()`, `versions() -> {"torch": …, "transformers": …}`, and `python -m app.core.model --download` (snapshot download for the Docker build).
- [ ] T010 [P] Implement `backend/app/limits.py`. Load `limits.json` from env `LIMITS_PATH`, else `<repo>/contracts/limits.json`, else `/app/contracts/limits.json`. Expose a frozen dataclass `Limits(max_input_tokens, max_new_tokens, max_input_chars, wait_limit_s, example_steps, file_budget_bytes, initial_load_budget_bytes)`.
- [ ] T011 [P] Implement `backend/app/core/encode.py`:
  - `pack_causal(att: ndarray[H,T,T]) -> ndarray[H, T*(T+1)//2]` with "index of (i, j), j ≤ i = i(i+1)/2 + j"
  - `quantize_u16(w)` = `round(w × 65535)` clipped to [0, 65535], scale `1/65535`
  - `to_le_bytes(arr, dtype)` for float32/uint16 little-endian
  - `encoded_array(arr, dtype, scale=None) -> {"dtype","shape","scale"?, "data": base64}`
  - `sha256_hex(bytes)`
  - `sig7(x: float) -> float` (7 significant digits, for probabilities and change percentages in JSON)
- [ ] T012 [P] Write `backend/tests/unit/test_encode.py`:
  - Packing indices for T=1..5.
  - Prefix property: the first t(t+1)/2 entries of each head equal `pack_causal` of the t-prefix.
  - Quantization max error ≤ 7.6e-6.
  - base64/little-endian round trip.
  - `sig7` keeps 7 significant digits.
- [ ] T013 Implement `backend/app/core/run.py` (shared by the service and the generator). Define `compute_run(token_ids: list[int], max_new_tokens: int) -> Run`:
  - **Greedy loop** with `past_key_values`. At each step, softmax the float32 logits of the last position (no temperature).
  - **Top-10 candidates**, "sorted by prob desc, ties by id asc": use a stable sort on `(-prob, id)`, not bare `topk`. `candidates[0]` is the appended token.
  - **Stop rules**:
    - If `candidates[0].id == eos_token_id`: do not append; `stop_reason="eos"`.
    - If `steps == max_new_tokens`: `stop_reason="step_limit"`.
    - If the length reaches `config.n_positions`: `stop_reason="context_limit"`.
  - **Predictions**: always compute the prediction for the final step, so `len(predictions) == steps + 1`.
  - **Full pass**: run one forward pass over the final sequence with `output_attentions=True`. Use a `register_forward_pre_hook` on each `transformer.h[l]` to capture the block input `x`, and forward hooks on `h[l].attn` (output[0] = `a`, after `c_proj`) and `h[l].mlp` (`m`).
  - **Change percentages**: `attn_change_pct = ‖a_i‖/‖x_i‖·100` and `mlp_change_pct = ‖m_i‖/‖(x+a)_i‖·100` per position. Do not use `output_hidden_states` (its last entry has `ln_f` applied).
  - **Other functions**: `attention_layer(token_ids, layer_1based) -> ndarray[H,T,T]` and `token_embeddings(token_ids) -> (unique_ids in first-appearance order, wte rows float32)`.
  - **Serialization**: `Run.to_core()` returns the `RunCore` dict from `contracts/example-data.schema.json`, with tokens as `{id, bytes}` and floats via `sig7`.
- [ ] T014 Write `backend/tests/unit/test_run.py` (marker `model`) and check that:
  - `len(tokens) == n_input + steps` and `len(predictions) == steps + 1`
  - `predictions[k-1].candidates[0].id == tokens[n_input+k-1].id`
  - candidates are "sorted by prob desc, ties by id asc" and every prob satisfies "0 < prob ≤ 1"
  - change % is "≥ 0, finite"
  - attention is "∈ [0, 1]" with every row summing to 1 ± 1e-5, and future entries are exactly 0
  - `max_new_tokens=0` gives `steps == 0` and one prediction
  - `tokenize("<|endoftext|>")` does not contain `eos_token_id()` (R8)
  - two runs of the same input are bit-identical (FR-006)
- [ ] T015 [P] Create `backend/tools/examples.toml` with exactly six `[[example]]` entries (`id`, `length`, `text`). Rules: id matches `^[a-z0-9-]{1,40}$`; length is `short` | `medium` | `long` (exactly 2 of each); the text is English to continue with no trailing `?`. The first entry is the default. Start from these drafts and adjust the wording until T016's rules pass:
  - `short-once-upon` = "Once upon a time, there was a little"
  - `short-coffee` = "The best way to make a cup of coffee is to"
  - `medium-sun` = "The Sun is a huge ball of hot gas at the center of our solar system. Every day, it gives the Earth light and heat, which"
  - `medium-train` = "When the train finally pulled into the station, Maria grabbed her suitcase and stepped onto the platform. The first thing she noticed was"
  - `long-lighthouse` = "The old lighthouse keeper climbed the spiral stairs every evening at sunset. He checked the lamp, wiped the salt from the windows, and wrote a short note in his logbook. On the night of the great storm, the waves rose higher than he had ever seen, and"
  - `long-library` = "The city council met on Tuesday to discuss the new public library, which is expected to open next spring. Members agreed that the building should include a children's reading room, a small café and a quiet space for students. The final decision on the budget will be"
- [ ] T016 Implement `backend/tools/generate_examples.py` (`python -m tools.generate_examples [--check]`). It uses `app.core.model` and `app.core.run`. For each example it computes the run with `max_new_tokens = limits.example_steps`.
  - **Rules (R20)**: fail unless:
    - input tokens fall within the band (short 5–15, medium 20–35, long 50–64, always ≤ `max_input_tokens`)
    - there is no trailing `?`
    - `steps == 20` or `stop_reason == "eos"`
    - the top-1 − top-2 probability margin is ≥ 1e-3 at every step
    - every written file is < `file_budget_bytes`
  - **Writes**:
    - `frontend/public/data/examples/<id>/core.json`: `ExampleCore`, `format_version "1.0.0"`, `model {id, revision, versions}`, and `files` with `path`/`dtype`/`shape`/`bytes`/`sha256` (+`scale`, `unique_ids`)
    - `embeddings-token.f32`: shape `[U, n_embd]`, rows of `wte[unique_ids[r]]`
    - `attention-L01.u16` … `attention-LNN.u16`: one file per layer, NN = 2-digit 1-based, shape `[n_head, T(T+1)/2]`, scale 1/65535
    - `frontend/public/data/examples/index.json`: `ExampleIndex`, examples in toml order, with `position_embeddings` shards
    - `frontend/public/data/model/wpe-0000-0063.f32` and `wpe-0064-0127.f32`: shards of 64 rows covering positions `0 .. max_input_tokens + max_new_tokens − 1`, each with `first_position`
    - `frontend/src/generated/gpt2-config.json`: verbatim copy of `config.json` from `hf_hub_download(MODEL_ID, "config.json", revision=MODEL_REVISION)`
    - `frontend/tests/reference/param-shapes.json`: `{name: shape}` from `model.state_dict()` with the `transformer.` prefix stripped, buffers (`attn.bias`, `attn.masked_bias`) excluded, and `lm_head.weight` included
    - `contracts/fixtures/data/tiny-example/`: text "Hello world", `max_new_tokens=2`, band rules skipped, same file layout
  - **Validation**: validate every JSON against `contracts/example-data.schema.json` (jsonschema Draft 2020-12). Output is deterministic (stable key order, trailing newline). `--check` regenerates into a temp dir and exits non-zero if anything differs from the committed files.
  - **README**: fill the "Regenerate example data" section with `uv run python -m tools.generate_examples` and `--check`, and say where the model revision is pinned.
- [ ] T017 Run `cd backend && uv run python -m tools.generate_examples`. Iterate on `backend/tools/examples.toml` until every rule passes, then commit the generated files under `frontend/public/data/`, `frontend/src/generated/gpt2-config.json`, `frontend/tests/reference/param-shapes.json` and `contracts/fixtures/data/tiny-example/`
- [ ] T018 Implement `backend/tools/verify_examples.py` (`python -m tools.verify_examples [--self-test]`, FR-041). It must use an independent code path: no imports from `app.core.run` or `app.core.encode`; it loads the model directly with transformers at `MODEL_REVISION`.
  - **Reference runs**: for every example and every step k, run the reference on the prefix of length `n_input + k`.
  - **Decoding**: decode the shipped JSON and binaries itself (numpy `frombuffer`, its own unpacking) and verify every SHA-256.
  - **Tolerances**:
    - tokens and top-10 ids identical
    - probabilities ≤ 1e-4 absolute
    - attention rows ≤ 1e-3 absolute
    - token/position embeddings and change % ≤ 0.1 % relative; compute change % with its own hooks
  - **Output**: one line per example/step, then `PASS`, or a non-zero exit with the first breaches.
  - **`--self-test`**: corrupt an in-memory copy (one prob +2e-4, one attention cell +2e-3, one embedding ×1.002) and assert that each corruption is detected.
  - **README**: add `uv run python -m tools.verify_examples` and `--self-test` to the "Regenerate example data" section (regenerate → verify → `--check`).
- [ ] T019 Run `cd backend && uv run python -m tools.verify_examples` and `--self-test`. Both must pass (SC-001).

### Frontend core libraries

- [ ] T020 [P] Implement `frontend/src/lib/model/config.ts`. Import `../../generated/gpt2-config.json` and validate it: "loader rejects the config if any required field is missing, non-integer, ≤ 0, or if `n_embd % n_head ≠ 0`".
  - Export a typed `modelConfig`: `{ nLayer, nHead, nEmbd, nInner, dHead, vocabSize, nPositions, activationFunction, layerNormEpsilon, tieWordEmbeddings, eosTokenId }`.
  - `nInner` = `n_inner ?? 4 * n_embd`. Add a comment citing the HF GPT-2 semantics; the factor 4 is architecture semantics, not a size.
  - `tieWordEmbeddings` defaults to `true`.
  - `activationLabelKey`: `gelu_new` → i18n key `model.activation.gelu_new`.
  - Also export `validateConfig(raw)`.
- [ ] T021 [P] Write `frontend/tests/unit/model/config.test.ts`: the bundled config loads; `validateConfig` rejects a missing field, non-integer, 0, negative and indivisible `n_embd % n_head`; `nInner` falls back to 4·n_embd when `n_inner` is null
- [ ] T022 [P] Create `frontend/src/lib/limits.ts`: import `$contracts/limits.json` and export a typed `limits` object
- [ ] T023 [P] Add API type generation. `gen:api-types` = `openapi-typescript ../contracts/inference-api.openapi.yaml -o src/generated/api-types.ts`. `check:api-types` regenerates to a temp file and fails if it differs from the committed file. Commit `frontend/src/generated/api-types.ts`.
- [ ] T024 [P] Implement `frontend/src/lib/data/binary.ts`:
  - `decodeBinary(buf: ArrayBuffer, {dtype, shape, scale?}) -> Float32Array`: assert `byteLength === product(shape) × sizeof(dtype)`, else throw `DataFormatError` (fail closed). The value is stored × scale.
  - `decodeEncodedArray(e)` (base64 → same path).
  - `packedIndex(i, j) = i*(i+1)/2 + j`.
  - `attentionRow(headData, i) -> Float32Array(i+1)`.
  - `prefixPackedLength(t) = t*(t+1)/2`.
- [ ] T025 [P] Write `frontend/tests/unit/data/binary.test.ts` against `contracts/fixtures/data/tiny-example/`: decode every file, a wrong byteLength throws, `attentionRow` sums to 1 ± (i+1)·2⁻¹⁶, and the prefix of the packed data equals the rows for a shorter t
- [ ] T026 Define the shared data interface in `frontend/src/lib/data/runData.ts`, with TS types mirroring `RunCore`, `Token`, `Prediction` and `LayerChange` from the schema.
  - `interface RunData { source: 'example'|'live'; nInput; steps; stopReason; tokens; predictions; layers; getAttention(layer1: number): Promise<Float32Array[]>; getTokenEmbeddings(): Promise<{uniqueIds: number[]; rows: Float32Array}> }`
  - Step helpers: `tokensAt(run, k)` returns the prefix `[0, nInput+k)`, `predictionAt(run, k)`, `changeAt(run, layer1, k)` returns prefix-sliced `attn`/`mlp` arrays, and `attentionAt(heads, k)` slices the first `prefixPackedLength(nInput+k)` entries.
  - Domain checks: "1 ≤ n_input ≤ `max_input_tokens`", "0 ≤ steps ≤ cap (20 for examples, 64 live)", and Token "0 ≤ id < V", "bytes length ≥ 1".
  - Implement `assertRunCore(obj)`: a hand-written runtime guard that checks the shape plus the consistency rules from `contracts/example-data.md` rule 3, with no runtime Ajv.
- [ ] T027 Implement `frontend/src/lib/data/exampleSource.ts`. `loadIndex()` fetches `${import.meta.env.BASE_URL}data/examples/index.json`. `loadExample(id) -> Promise<RunData>` fetches `core.json`, runs `assertRunCore`, and lazy-loads and memoizes attention files per layer and `embeddings-token.f32` on first use. Failures raise a typed `ExampleLoadError(exampleId, kind)` that affects only that example. Add `loadPositionEmbeddings(count)` → `Float32Array[count × n_embd]` from the shared `wpe-*` shards listed in `index.json` (lazy, memoized; used by both modes).
- [ ] T028 [P] Write `frontend/tests/unit/data/exampleSource.test.ts`. Mock `fetch` to serve the tiny-example fixture. Check that the lazy files are fetched only on demand and only once, and that a corrupt or missing attention file rejects only that call while `core.json` data stays usable.
- [ ] T029 [P] Write `frontend/tests/contract/example-data.test.ts`. Use Ajv 2020 to validate the committed `frontend/public/data/examples/index.json`, every `core.json` and the tiny fixture against `contracts/example-data.schema.json`. Also assert that:
  - each file's `bytes` equals its size on disk, every `sha256` matches (node:crypto), and every file is < `limits.file_budget_bytes`
  - there are exactly 2 short, 2 medium and 2 long examples, each with `n_input` within its band and ≤ `limits.max_input_tokens`
  - no example text ends with `?`
  - `index.json` `model.revision` equals every `core.json` `model.revision`
- [ ] T030 [P] Implement `frontend/src/lib/tokens/display.ts`:
  - `tokenDisplay(bytes, id)` → `{ kind: 'text'|'partial'|'eos', text, leadingSpace, newline, hex }`, decoding with `new TextDecoder('utf-8', {fatal: true})`
  - Leading space becomes the visible marker `␣` and newline becomes `⏎` (exposed as separate flags so CSS can style them subtly)
  - On a decode failure → `partial` with byte values formatted `⟨E2 80⟩`
  - `id === modelConfig.eosTokenId` → `eos`
  - Add tests in `frontend/tests/unit/tokens/display.test.ts`: " the", "\n", a split emoji, an accented letter split across tokens, EOS.
- [ ] T031 [P] Implement `frontend/src/lib/tokens/palette.ts`: 12 token background colors per theme (light, dark) and `tokenColor(position, theme) = palette[position mod palette.length]`, so a token's color never changes between views or steps, plus `tokenTextColor`. Write `frontend/tests/unit/palette/palette.test.ts`, which computes the WCAG 2.1 contrast ratio for text on every palette color in both themes and asserts ≥ 4.5:1. Also assert that neighboring palette entries differ (ΔE or luminance difference > a documented threshold).
- [ ] T032 Implement i18n in `frontend/src/lib/i18n/index.ts`:
  - Svelte 5 `$state` locale (`'en'|'tr'|'de'`).
  - `t(key: MessageKey, params?)`. `MessageKey` is derived from `en.json`. Placeholders use the `{name}` syntax. Plurals use `Intl.PluralRules` with `key.one`/`key.other` keys. A missing key renders `⟦key⟧` and `console.error`s in dev and test.
  - `setLocale(l)` lazy-loads `tr.json`/`de.json` via dynamic import. `en` is bundled.
  - Add `frontend/src/lib/i18n/format.ts` with `formatNumber`, `formatPercent`, `formatProb(p, digits)`, `formatCompact` and `formatBytes` (1 MB = 1,000,000 B) via `Intl.NumberFormat(locale)`.
- [ ] T033 [P] Create the catalogs `frontend/src/lib/i18n/{en,tr,de}.json`: flat keys for the app shell (app title, view names in flow order, nav, theme switch, loading, generic errors, "Show details"/"Hide details", "Show as table"). Create `frontend/src/lib/i18n/glossary.{en,tr,de}.json` with the minimum term set `token`, `attention`, `embedding`, `layer`, `head`, `mlp`, `logit`, `probability-distribution`, `prefill`, `decode`, `flops`, `kv-cache`, each `{ "term": <English>, "explanation": <one or two plain sentences in that locale> }`.
- [ ] T034 [P] Write `frontend/tests/unit/i18n/completeness.test.ts` (SC-008):
  - "key set of `tr` and `de` must equal `en` exactly; no empty values"
  - the `{name}` placeholder sets are identical per key
  - the glossary ids are equal across locales, and `term` is identical (English) in all locales
  - every ApiError code in `contracts/inference-api.openapi.yaml` `ErrorCode` and every client code (`timeout`, `network`, `wake_timeout`, `version_mismatch`, `invalid_response`) has an `error.<code>` key
  - every example id in `index.json` has `example.<id>.title`
- [ ] T035 [P] Implement `frontend/src/lib/motion.ts`: a reactive `reducedMotion` flag bound to `matchMedia('(prefers-reduced-motion: reduce)')`, and `duration(ms)` returning 0 when reduced (FR-036)
- [ ] T036 Implement `frontend/src/lib/state/viewState.svelte.ts`:
  - A `ViewState` class with `$state` fields: `mode` (`example`|`live`), `exampleId`, `view`, `layer`, `head`, `step`, `lang`, `theme` (`light`|`dark`|`system`).
  - Export `VIEWS = ['tokens','embeddings','blocks','attention','prediction','architecture','cost','method'] as const`. The first five are the "inside the machine" flow order (FR-021).
  - Setters clamp to the domains: layer `1..modelConfig.nLayer`, head `1..modelConfig.nHead`, step `0..run.steps`, view ∈ VIEWS, lang ∈ en|tr|de.
  - `setExample` resets step to 0 and keeps view, layer and head.
  - Theme is persisted in `localStorage` key `itt.theme` inside try/catch and applied as `document.documentElement.dataset.theme`.
  - **Live text is NOT part of this class.**
- [ ] T037 [P] Write `frontend/tests/unit/state/viewState.test.ts`: clamping of layer/head/step/view/lang, the `setExample` reset rule, and that theme persistence survives a throwing `localStorage`
- [ ] T038 Create the design system in `frontend/src/styles/theme.css` and `frontend/src/styles/global.css` (FR-037, FR-039, FR-040):
  - Color tokens on `:root` and dark overrides under `@media (prefers-color-scheme: dark)` for `:root:not([data-theme="light"])` and `:root[data-theme="dark"]`. Every text/background pair is ≥ 4.5:1.
  - A visible `:focus-visible` ring (≥ 3:1 against adjacent colors).
  - "Machine interior" visual language: dark panel surfaces, mono numerals for data, consistent spacing/radius scale, a subtle grid backdrop.
  - Responsive layout from 360 px wide, with no horizontal page scroll; wide data scrolls inside its own container.
  - Import `fonts.css` and both stylesheets in `frontend/src/main.ts`.
- [ ] T039 [P] Create `frontend/src/components/ShowDetails.svelte`: a disclosure button with `aria-expanded`/`aria-controls`, a translated "Show details"/"Hide details" label, and content that is not rendered until opened (FR-032)
- [ ] T040 [P] Create `frontend/src/components/Term.svelte`. It renders the English glossary term and, on the term's first appearance in the current view, an inline plain-language explanation in the current locale. Later appearances show the explanation in an accessible popover/`<abbr>`-style toggle. First appearance is tracked by a per-view context `createTermRegistry()` exported from `frontend/src/components/termRegistry.ts` (FR-030).
- [ ] T041 [P] Create `frontend/src/components/ViewIntro.svelte`: a heading plus the view's one-sentence plain-language explanation from i18n (FR-031)
- [ ] T042 [P] Create `frontend/src/components/TokenChip.svelte`. Props: `token`, `position`, `theme`, `highlighted`, `origin`. It renders the background from `tokenColor` and the text from `tokenDisplay`, with the `␣`/`⏎` markers, partial-byte rendering and an EOS label. It always carries a text label and an accessible name that includes the position ("token 3: ' cat'"), so color is never the only cue (FR-035). Generated tokens get an extra non-color marker (e.g. an underline style plus "generated" in the accessible name).
- [ ] T043 Create `frontend/src/components/TokenSequence.svelte`: renders `tokensAt(run, step)` as wrapping `TokenChip`s, with an optional `highlight: number[]` and an `onfocustoken`/`onhovertoken` callback. Used by Tokens, Embeddings, Blocks, Attention and Prediction.
- [ ] T044 Create `frontend/src/components/FlowIndicator.svelte` and `frontend/src/components/ViewNav.svelte`. The nav lists VIEWS, with the flow views grouped as "Inside the machine" (text → tokens → embeddings → blocks → attention → prediction) and architecture/cost/method as "Reference". It uses `aria-current="page"`, is keyboard reachable, and wraps on mobile. FlowIndicator persistently shows where the visitor is in the flow (FR-021).
- [ ] T045 [P] Create `frontend/src/components/ThemeSwitch.svelte` (system / light / dark, a radio group with translated labels) bound to `viewState.theme`
- [ ] T046 Create `frontend/src/App.svelte` and `frontend/src/main.ts`:
  - **Layout**: header (title, slots for the language switch, mode switch and theme switch), an intro area, an example-picker slot, FlowIndicator + ViewNav, and a view outlet.
  - **Views**: each view in `frontend/src/views/*.svelte` is lazy-loaded with a dynamic `import()` and wrapped in `<svelte:boundary>` with a translated error fallback, so one failing view never breaks the others (Principle V).
  - **Notices**: a polite `aria-live` notice region.
  - **Placeholders**: a placeholder view component for each view not yet built. Its root carries `data-placeholder`, and every view root (placeholder or real) carries `data-view="<id>"`. Every ViewNav entry carries `data-view="<id>"` too, so tests can navigate without depending on translated labels.
- [ ] T047 [P] Implement `frontend/scripts/check-budgets.mjs` (Principle VII). It fails if any file under `frontend/dist/data/**` is ≥ `limits.file_budget_bytes`. It also computes the initial-load set and fails if its total is ≥ `limits.initial_load_budget_bytes`. The initial-load set is:
  - `index.html`
  - the entry chunk plus its static imports, from `dist/.vite/manifest.json`
  - the CSS
  - the fonts referenced by `@font-face` that the first view uses
  - `data/examples/index.json`
  - the default example's `core.json`

  It prints a table of the sizes.
- [ ] T048 [P] Write `frontend/tests/unit/no-arch-literals.test.ts`: scan `frontend/src/**/*.{ts,svelte}` excluding `src/generated/` for the regex `\b(768|3072|50257|1024|124439808)\b` and fail with file:line (Quality Gate 2)
- [ ] T049 [P] Write `frontend/tests/reference/gpt2-small.md` with hand derivations from the official config values (d=768, L=12, H=12, f=3072, V=50257, P=1024):
  - **Parameters**: wte 38,597,376; wpe 786,432; per block 7,087,872 (ln_1 1,536 + c_attn 1,771,776 + attn.c_proj 590,592 + ln_2 1,536 + c_fc 2,362,368 + mlp.c_proj 2,360,064); 12 blocks 85,054,464; ln_f 1,536; total 124,439,808 (tied LM head counted once).
  - **Per-layer decode components**: QKV 6d² = 3,538,944; output projection 2d² = 1,179,648; MLP 4df = 9,437,184; per-layer matmuls per token = 14,155,776; ×12 = 169,869,312; scores and weighting 2dt each; LM head 2dV = 77,194,752; position add d = 768.
  - **Totals**: decode(1) = 247,101,696; decode(10) = 247,433,472; decode(1024) = 284,813,568; prefill(10) = 1,777,923,072; prefill(64) = 11,025,556,992.
  - **KV cache**: 73,728 B per token; 75,497,472 B at t = 1024.

  Each value gets a written derivation line and a machine-readable JSON block for the tests to import.

### Automated quality gates (Principles VI, VII, IX; in place before any user story)

- [ ] T049a [P] Write `frontend/tests/unit/readme-doc-check.test.ts` (Principle IX). It reads the root `README.md` and fails, naming each missing item, unless the README contains:
  - `npm run <name>` for every key in `frontend/package.json` `scripts`
  - `python -m tools.<name>` for every module in `backend/tools/*.py` (excluding `__init__.py`)
  - `uvicorn app.main:app` once `backend/app/main.py` exists

  Fix the README until the check passes. T134 later extends this check to the commands in `quickstart.md`.
- [ ] T049b [P] Write `frontend/tests/e2e/a11y.spec.ts` (`@a11y`, FR-044, SC-007, Principle VI), after T046. For every id in `VIEWS` × color scheme {light, dark} (`page.emulateMedia({ colorScheme })`; theme defaults to `system`) × browser-context `locale` {en-US, tr-TR, de-DE}:
  - navigate through the ViewNav entry `[data-view="<id>"]`
  - run `new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa'])`, once with all `ShowDetails` closed and once with them all open
  - expect zero violations

  Placeholder views are checked too, so each real view is covered as soon as it replaces its placeholder. Locales take effect once US5's `resolveLocale` lands (T096); until then the tr/de runs render English and still have to pass.
- [ ] T049c [P] Create `frontend/lighthouserc.json` (Principle VII, SC-011). Collect from `npm run preview` at `/` with the mobile preset (`formFactor: mobile`, simulated throttling, 3 runs, median). Assert:
  - `categories:performance` ≥ 0.9
  - `largest-contentful-paint` `maxNumericValue` 3000 (SC-011 "first usable view within 3 s")
  - `total-blocking-time` `maxNumericValue` 200
  - `resource-summary:total:size` < `2000000`

  Add the `lhci` script (`lhci autorun`) and document it in the README.
- [ ] T049d Create `.github/workflows/frontend.yml` and `.github/workflows/backend.yml` (after T047, T049a–T049c). Later tasks (T135, T136) extend these files; they do not recreate them.
  - **frontend.yml** (push, pull_request; Node 22): `npm ci`, `lint`, `typecheck`, `check:api-types`, `test:unit` (includes T048 and T049a), `test:contract`, `build`, `check:budgets`, Playwright install, `test:e2e` (default projects chromium + mobile, which run every spec present, including `@a11y`), and `lhci`. A `deploy` job on `main` publishes `frontend/dist` to GitHub Pages (`actions/upload-pages-artifact` + `actions/deploy-pages`) and `needs:` every check job, so nothing deploys unless all gates pass.
  - **backend.yml** (push, pull_request): `uv sync`, `ruff check`, a cache for `~/.cache/huggingface` keyed on `MODEL_REVISION`, `pytest` (all markers), `python -m tools.generate_examples --check`, `python -m tools.verify_examples` and `--self-test`.
  - **README**: add a short "CI" section listing what each workflow checks. Note that `main` must be protected with both workflows' check jobs as required status checks: the project owner configures this in the repository settings, and the README says so.
  - From here on a story's changes merge only with both workflows green. Within a story, tests are still written first and seen failing locally before the implementation lands.

**Checkpoint**: Generated example data is verified (T019). Frontend libraries, i18n, state and shell are in place. CI runs the budget, accessibility, Lighthouse, README and data checks on every push (T049d), so user stories can start.

---

## Phase 3: User Story 1 - Watch the model continue an example text (Priority: P1) 🎯 MVP

**Goal**: Example mode with six examples, the Tokenization and Prediction views, one-token-at-a-time stepping forward and back. No server needed.

**Independent Test**: With no API configured and all non-same-origin requests blocked, open the site, choose each of the six examples, step through tokenization and prediction, and generate up to the last precomputed step. All values equal `core.json` (quickstart Q1).

### Tests for User Story 1 ⚠️

- [ ] T050 [P] [US1] Write `frontend/tests/unit/state/generation.test.ts`:
  - `canAdvance` is true iff k < steps.
  - `endMessageKey`: `example.end.step_limit`, `example.end.eos`, `example.end.context_limit`.
  - `detectRepetition`: true iff, within `tokens[0, nInput+k)`, some sequence of 3 token ids occurs at least twice and the later occurrence includes a generated token.
- [ ] T051 [P] [US1] Write `frontend/tests/e2e/example-mode.spec.ts` (`@example-mode`), run with `VITE_API_BASE_URL` unset. A `page.route` aborts every request whose origin ≠ the preview origin, and the test asserts that no request goes to any API path. It checks:
  - the landing state: example mode, first example selected, the "GPT-2 continues text" note visible
  - the picker lists 6 examples labelled 2 short / 2 medium / 2 long
  - the Tokens view: chips are visible; "Show details" shows the ID and exact text with `␣`
  - the Prediction view: 10 candidates sorted desc, the first marked as the greedy choice
  - "Next token" ×3 appends tokens (the step counter reads 3), and Back returns exactly to step 2 (same tokens, same candidates); forward again reproduces the same token
  - at the last step "Next token" is disabled, the end message is shown, and no live offer appears
  - this repeats for all six examples, with values compared against the committed `core.json`

### Implementation for User Story 1

- [ ] T052 [US1] Implement `frontend/src/lib/state/generation.ts` (`canAdvance`, `endMessageKey(stopReason)`, `detectRepetition(tokens, nInput, k)`) per T050
- [ ] T053 [P] [US1] Create `frontend/src/components/IntroNote.svelte`: one or two translated sentences explaining that GPT-2 continues text and does not answer questions like a chat assistant (FR-002), shown on the landing view and dismissible for the session (in memory only)
- [ ] T054 [P] [US1] Create `frontend/src/components/ExamplePicker.svelte`: an accessible radio group or `<select>` grouped by length ("Short", "Medium", "Long"), using translated titles `example.<id>.title` and showing the input token count. Selecting an example calls `viewState.setExample(id)`, which resets the step to 0.
- [ ] T055 [US1] Create `frontend/src/components/GenerationControls.svelte`:
  - Back and "Next token" buttons and a "Step k of N" counter (FR-007).
  - On advance, an `aria-live` announcement names the appended token. The new chip animates in with `duration()` from `motion.ts` (FR-036).
  - At k = steps, "Next token" is `disabled` with the end message from `endMessageKey`. For EOS, the end-of-text marker is explained.
  - An optional `liveOffer` snippet prop is filled by US6.
  - When `detectRepetition` is true, show a short note that repetition is normal for greedy decoding.
- [ ] T056 [US1] Create `frontend/src/views/Tokens.svelte` (FR-014):
  - ViewIntro, `<Term id="token">`, a `TokenSequence` at the current step, and the token count.
  - A `ShowDetails` table with columns position, token ID, exact text (with `␣`/`⏎` markers), byte values for partial characters, and origin (input/generated).
  - A translated explanation when any token is `partial`.
- [ ] T057 [US1] Create `frontend/src/views/Prediction.svelte` (FR-018):
  - ViewIntro, `<Term id="logit">`, `<Term id="probability-distribution">`.
  - The ten candidates from `predictionAt(run, step)` as a ranked list, each with a horizontal bar (width ∝ prob), a `TokenChip`-style label and a percentage. The top one is marked "greedy choice" with a text badge, not color alone.
  - An EOS candidate renders as a labelled "end-of-text" marker.
  - A `ShowDetails` table with rank, ID, token and the probability to 7 significant digits.
  - GenerationControls.
- [ ] T058 [US1] Wire example mode into `frontend/src/App.svelte`:
  - On start, `loadIndex()` and then `loadExample(first id)`. Show translated loading and error states.
  - An `ExampleLoadError` shows `error.example_load` for that example only; the picker and the other examples keep working.
  - Pass the `RunData` and the current step to all views; mount IntroNote, ExamplePicker and GenerationControls.
  - Hide live mode when `import.meta.env.VITE_API_BASE_URL` is empty.
- [ ] T059 [US1] Add all US1 strings to `frontend/src/lib/i18n/{en,tr,de}.json`: the intro note, picker labels, the six `example.<id>.title` entries, Tokens/Prediction intros, details column headers, step counter (plural), end messages, the repetition note, EOS and partial-character explanations. T034 must pass.

**Checkpoint**: The MVP works offline: pick an example, see tokens and predictions, and step forward and back.

---

## Phase 4: User Story 2 - Look inside the machine: embeddings, layers and attention (Priority: P1)

**Goal**: The Embeddings, Blocks and Attention views with real numbers for every token up to the current step, fully usable with the keyboard.

**Independent Test**: Open any example. In Embeddings, see three strips per token and the full `n_embd`-row details table. In Blocks, step through layers 1–12 and check the change % values against `core.json`. In Attention, switch layer and head with the keyboard; the readout and table match the decoded attention file (quickstart Q1, Q10).

### Tests for User Story 2 ⚠️

- [ ] T060 [P] [US2] Write `frontend/tests/unit/data/embeddings.test.ts`: `buildEmbeddingVectors` on the tiny fixture gives token rows by `unique_ids` index and position rows from the shards. The sum equals `Math.fround(tok + pos)` element-wise, and each vector has length `modelConfig.nEmbd`.
- [ ] T061 [P] [US2] Write `frontend/tests/e2e/inside-machine.spec.ts` (`@layers`):
  - **Embeddings**: shows 3 strips per token, each with an accessible name; the details table for a chosen token has `n_embd` rows (read from the bundled config in the test).
  - **Blocks**: the layer indicator goes 1→12 with Next/Previous and with direct selection; the attention and MLP change % for token 0 equal the `core.json` values (formatted); the MLP part shows d → f → d sizes from the config.
  - **Attention**: select layer 5, head 3 with the keyboard only; arrow keys move the active cell and the `aria-live` readout reads "from … to …: 0.xxx"; masked cells are not selectable; "Show as table" row sums are 1 ± display rounding.
  - **Steps**: advancing the step adds a row and a column.
  - **Mobile**: on the `mobile` project with the longest example, the heatmap switches to focused mode (token picker + ranked list).

### Implementation for User Story 2

- [ ] T062 [P] [US2] Implement `frontend/src/lib/data/embeddings.ts`: `buildEmbeddingVectors(run, k) -> Promise<{position, token: Float32Array, position_: Float32Array, sum: Float32Array}[]>` for positions `[0, nInput+k)`. It uses `run.getTokenEmbeddings()` (row index = `uniqueIds.indexOf(id)`, cached in a Map) and `loadPositionEmbeddings`. The sum is computed in a `Float32Array`; all d dimensions are kept, with no subset (FR-015).
- [ ] T063 [P] [US2] Create `frontend/src/components/VectorStrip.svelte`: a `<canvas>` strip of one cell per dimension for all `nEmbd` values, on a diverging color scale centered at 0 that is symmetric over the max |value| across the three vectors of that token, so the strips are comparable. It is DPR-aware and fills the available width (≥ 1 device pixel per value). It has `role="img"` with an accessible name of label + min/max/mean, and theme-aware colors.
- [ ] T064 [P] [US2] Create `frontend/src/components/VectorTable.svelte`: a virtualized table (fixed row height, only visible rows rendered) of all `nEmbd` dimensions with columns dimension, token embedding, position embedding and sum (`formatNumber`, 6 significant digits), plus a caption naming the token. Keyboard scrollable with `tabindex="0"`.
- [ ] T065 [US2] Create `frontend/src/views/Embeddings.svelte` (FR-015, US2-1):
  - ViewIntro, `<Term id="embedding">`.
  - For each token at the current step: TokenChip plus three labelled VectorStrips ("token embedding", "position embedding", "sum").
  - Select a token (keyboard or click) to open a `ShowDetails` with its VectorTable.
  - Data loads lazily when the view opens, with translated loading and error states.
  - A token-flow animation (chip → strip) uses `duration()`.
- [ ] T066 [P] [US2] Create `frontend/src/components/LayerSelector.svelte`: Previous/Next buttons plus a direct `<select>` of layers `1..modelConfig.nLayer`, a label "Layer {n} of {total}" and `aria-live` on change. Bound to `viewState.layer`.
- [ ] T067 [P] [US2] Create `frontend/src/components/HeadSelector.svelte`: Previous/Next plus a direct `<select>` of heads `1..modelConfig.nHead`, bound to `viewState.head`
- [ ] T068 [P] [US2] Create `frontend/src/components/ChangeBars.svelte`: one row per token (TokenChip + horizontal bar + `formatPercent` value) for an array of change percentages, with a caption explaining "length of the update ÷ length of the token's vector before this part" (FR-016). Under `ShowDetails`, a table of the exact values.
- [ ] T069 [US2] Create `frontend/src/views/Blocks.svelte` (FR-016, US2-2/3):
  - ViewIntro, `<Term id="layer">`, `<Term id="attention">`, `<Term id="mlp">`, LayerSelector.
  - A schematic of one block: input → layer norm → attention ({nHead} heads × {dHead} each) → add → layer norm → MLP (`nEmbd` → `nInner` → activation label from `activationLabelKey` → `nEmbd`) → add. All sizes come from `modelConfig`.
  - Two ChangeBars at the current step: attention part (`changeAt(...).attn`) and MLP part (`.mlp`).
  - A link "See this layer's attention heads" sets the view to `attention` and keeps the layer.
  - A data-flow animation through the block uses `duration()`.
- [ ] T070 [US2] Create `frontend/src/components/Heatmap.svelte` (FR-017, FR-038, US2-4/5):
  - **Rendering**: `<canvas>` with rows = query tokens and columns = key tokens for the current prefix. Masked future cells (j > i) are drawn with a hatch pattern plus a lighter fill, so the mask is not shown by color alone. Valid cells use a sequential scale in both themes.
  - **Keyboard**: one focusable element (`tabindex="0"`, `role="grid"` semantics via `aria-roledescription` + `aria-activedescendant`, or a roving cell). Arrow keys, Home/End and PageUp/PageDown move within valid cells only (j ≤ i).
  - **Readout**: a polite `aria-live` readout "from ‘{query}’ to ‘{key}’: {weight}" (3 decimals; 7 significant digits in details).
  - **Highlighting**: hover or focus emits `onhighlight([i, j])`, so the parent highlights both tokens in their colors.
  - **Table**: "Show as table" renders a `<table>` with row and column headers.
  - **Focused mode**: when the computed cell size is < 10 CSS px, switch automatically to a token picker plus a ranked list of that token's weights (and a single-row strip). The same data is shown.
- [ ] T071 [US2] Create `frontend/src/views/Attention.svelte` (FR-017, US2-4/5/6):
  - ViewIntro, `<Term id="attention">`, `<Term id="head">`, LayerSelector + HeadSelector.
  - Lazy `run.getAttention(viewState.layer)` with loading and error states; pass the current head's data sliced by `attentionAt(heads, step)` to Heatmap.
  - A TokenSequence above with highlights from the heatmap.
  - A short explanation of causal masking.
- [ ] T072 [US2] Add all US2 strings (view intros, strip labels, table headers, block schematic labels, `model.activation.gelu_new` = "GELU (tanh approximation)" in each locale's wording, readout template, focused-mode labels, masking explanation) to `frontend/src/lib/i18n/{en,tr,de}.json`

**Checkpoint**: The visitor can follow text through embeddings, all blocks and every attention head.

---

## Phase 5: User Story 3 - Explore the architecture with real numbers (Priority: P1)

**Goal**: An architecture diagram in which every weight matrix and bias is selectable, showing shape, count and share, all derived from the config.

**Independent Test**: Select every parameter group. Shapes equal `param-shapes.json`, counts equal the hand references in `gpt2-small.md`, the total is 124,439,808, and the shares sum to 100% (quickstart Q4).

### Tests for User Story 3 ⚠️

- [ ] T073 [P] [US3] Write `frontend/tests/unit/model/params.test.ts`:
  - For every group `paramGroups(modelConfig)`, the shape equals `frontend/tests/reference/param-shapes.json[name]`, and the set of names equals the reference set.
  - `totalParams` equals the `gpt2-small.md` total.
  - The per-block, wte, wpe and ln_f counts equal the references.
  - `lm_head.weight` has `tied_to: 'wte.weight'` and is excluded from the total.
  - The shares of counted groups sum to 1 within 1e-12.
- [ ] T074 [P] [US3] Write `frontend/tests/e2e/architecture.spec.ts` (`@architecture`):
  - the diagram shows every component type and the "×{n_layer}" label
  - Tab/Enter on each component opens a panel with name, shape, count and share
  - selecting the LM head shows the tied-weights explanation
  - "Show in action" on attention at layer 4 opens the Attention view with layer 4

### Implementation for User Story 3

- [ ] T075 [US3] Implement `frontend/src/lib/model/params.ts`:
  - `paramGroups(config): ParamGroup[]` with `{ name, component, layer, shape, count, share, tiedTo, formulaId: 'params-<component>' }`. Names are HF state-dict names (`wte.weight`, `wpe.weight`, `h.{l}.ln_1.weight|bias`, `h.{l}.attn.c_attn.weight|bias`, `h.{l}.attn.c_proj.weight|bias`, `h.{l}.ln_2.weight|bias`, `h.{l}.mlp.c_fc.weight|bias`, `h.{l}.mlp.c_proj.weight|bias`, `ln_f.weight|bias`, `lm_head.weight`).
  - Shapes from data-model.md: wte (V, d); wpe (P, d); ln_* (d); c_attn.weight (d, 3d), bias (3d); attn.c_proj.weight (d, d), bias (d); c_fc.weight (d, f), bias (f); mlp.c_proj.weight (f, d), bias (d). Label them as "HF Conv1D order (in × out)".
  - `count` = product of the shape; `share` = count / total; "shares of counted groups sum to 1". `lm_head.weight` has `tiedTo: 'wte.weight'` and is excluded from the total.
  - Buffers are not parameters.
  - `totalParams(config)` and `perBlockParams(config)`.
- [ ] T076 [US3] Create `frontend/src/views/Architecture.svelte` (FR-019, US3-1..4):
  - **Diagram**: hand-written inline SVG, laid out vertically and responsive at 360 px: token embedding (wte) + position embedding (wpe) → add → a repeated block labelled "× {nLayer}" (ln_1, attention [c_attn, c_proj], ln_2, MLP [c_fc, c_proj]) → ln_f → LM head.
  - **Selection**: every weight and bias is a focusable `<button>`/`role="button"` element inside the SVG, with a visible focus ring. A LayerSelector picks which block's `h.{l}` groups are selected.
  - **Panel**: shows name, shape ("in × out"), count (`formatNumber`) and share (`formatPercent`, 3 decimals). For `lm_head`, the panel explains that it shares weights with the token embedding and is counted once.
  - **"Show in action"**: wte/wpe → Embeddings; ln_*/mlp → Blocks at that layer; attn → Attention at that layer; lm_head → Prediction.
  - **Table**: `ShowDetails` with a table of all groups (the text equivalent of the diagram) and the total.
  - **Terms**: `<Term>` for layer, attention, MLP and embedding.
- [ ] T077 [US3] Add all US3 strings (component names and descriptions, panel labels, tied-weights explanation, "Show in action", Conv1D-order note) to `frontend/src/lib/i18n/{en,tr,de}.json`

**Checkpoint**: The Architecture view works on its own; it needs only the config.

---

## Phase 6: User Story 4 - Understand what one token costs to compute (Priority: P1 statistics; P2 chart; P3 KV cache)

**Goal**: Prefill, decode and running-total FLOP estimates per layer and component; a context-length chart; KV-cache memory. Every value is labelled and links to its formula.

**Independent Test**: For each example and step, every displayed value equals `flops.ts`/`kvcache.ts` output. Those functions match the `gpt2-small.md` references (Q4), and every estimate carries the label and link.

### Tests for User Story 4 ⚠️

- [ ] T078 [P] [US4] Write `frontend/tests/unit/model/flops.test.ts` against the JSON block in `frontend/tests/reference/gpt2-small.md`. Check:
  - per-layer component values for decode (qkv, attn_out, mlp, scores and weighting at t = 10)
  - per-layer sum per token
  - LM head and position add
  - `decodeFlops` at t = 1, 10, 1024 and `prefillFlops` at n = 10, 64
  - `runningTotal(n, k) = prefill(n) + Σⱼ₌₁..ₖ decode(n + j)` for n = 10, k = 3
  - every value satisfies `Number.isSafeInteger`
- [ ] T079 [P] [US4] Write `frontend/tests/unit/model/kvcache.test.ts`: `kvCacheBytes(config, 1)` and `kvCacheBytes(config, 1024)` equal the references. The formula is `2·L·t·d·4`.
- [ ] T080 [P] [US4] Write `frontend/tests/e2e/cost.spec.ts` (`@cost`):
  - at step 0, prefill shows and decode shows "no new token yet"
  - at step 3, decode equals `decodeFlops(n_input+3)` (formatted) and the running total is correct
  - the per-layer table has `n_layer` rows plus embeddings and LM head rows
  - every number has a "theoretical estimate" label and a link to `?view=method…#<formula-id>`
  - the chart marks the current context length
  - the KV panel shows the bytes for the current t

### Implementation for User Story 4 (P1: per-token and per-layer)

- [ ] T081 [P] [US4] Implement `frontend/src/lib/model/flops.ts` (R10). Use the `CostEstimate` type: `{ kind: 'flops'|'bytes', phase: 'prefill'|'decode'|'total'|'kv_cache', component: 'qkv'|'attn_scores'|'attn_weighting'|'attn_out'|'mlp'|'pos_add'|'lm_head'|'all', layer: number|null, inputs, value, formulaId, isEstimate: true }`. Here value is an "integer (exact, BigInt-safe ≤ 2⁵³)"; assert `Number.isSafeInteger`.
  - **Per layer, prefill over n**:
    - qkv 6d²n
    - attn_scores d·n(n+1)
    - attn_weighting d·n(n+1)
    - attn_out 2d²n
    - mlp 4dfn
  - **Per layer, decode at t**:
    - qkv 6d²
    - attn_scores 2dt
    - attn_weighting 2dt
    - attn_out 2d²
    - mlp 4df
  - **Non-layer**: pos_add d·n (prefill) or d (decode); lm_head 2dV in both phases.
  - **Exports**: `prefillFlops(config, n)` and `decodeFlops(config, t)` return the `{ breakdown: CostEstimate[], total }` breakdown. `costAtStep(config, nInput, k)` returns `{ prefill, decode: k ≥ 1 ? decodeFlops(nInput + k) : null, runningTotal }`.
  - **Formula ids**: `flops-qkv`, `flops-attn-scores`, `flops-attn-weighting`, `flops-attn-out`, `flops-mlp`, `flops-pos-add`, `flops-lm-head`, `flops-prefill-total`, `flops-decode-total`, `flops-running-total`.
- [ ] T082 [P] [US4] Implement `frontend/src/lib/model/kvcache.ts`: `kvCacheBytes(config, t, bytesPerValue = 4)` = `2·L·t·d·bytesPerValue` as a CostEstimate with `phase 'kv_cache'` and `formulaId 'kv-cache-bytes'`
- [ ] T083 [P] [US4] Create `frontend/src/components/EstimateLabel.svelte`: a visible "theoretical estimate" badge (text, not icon-only) plus a link "How we calculate". The link's `href` is the serialized current state with `view=method` and `#<formulaId>`; clicking it sets `viewState.view = 'method'` and scrolls to and focuses the anchor (FR-027).
- [ ] T084 [US4] Create `frontend/src/views/Cost.svelte` (FR-022–FR-024, US4-1..3):
  - ViewIntro, `<Term id="flops">`, `<Term id="prefill">`, `<Term id="decode">`.
  - Three headline figures from `costAtStep`: prefill for `nInput` tokens; decode for the token at step k (at k = 0, explain that no token has been generated yet); the running total for input plus k generated tokens. Each uses `formatCompact` with the exact integer in `ShowDetails`.
  - A per-layer table: rows = layers 1..`nLayer` plus "Embeddings (position add)" and "LM head" as separate non-layer rows; columns = the components, for the selected phase (toggle prefill/decode).
  - Every number carries an EstimateLabel; only values from `flops.ts`/`kvcache.ts` are rendered (Principle II).

### Implementation for User Story 4 (P2: context-length chart)

- [ ] T085 [US4] Create `frontend/src/components/CostChart.svelte` and mount it in `frontend/src/views/Cost.svelte` (FR-025):
  - An inline SVG line chart of `decodeFlops(config, t).total` for t = 1..`nPositions`, with axis labels and translated, locale-formatted tick values.
  - A marker and label at the current context length `nInput + k`.
  - Focusable, with a text summary ("cost grows linearly from … to …").
  - "Show as table" lists t at every 64 positions plus the current t.
  - An EstimateLabel linked to `flops-decode-total`.

### Implementation for User Story 4 (P3: KV cache)

- [ ] T086 [US4] Add a KV-cache panel to `frontend/src/views/Cost.svelte` (FR-026): `<Term id="kv-cache">`, `kvCacheBytes(config, nInput + k)` formatted with `formatBytes` (1 MB = 1,000,000 B), a two-sentence explanation of what the KV cache stores (keys and values of earlier tokens for every layer), the 32-bit precision noted, and an EstimateLabel
- [ ] T087 [US4] Add all US4 strings (headline labels, table headers, component names, chart axis/summary, KV explanation, "theoretical estimate", "How we calculate") to `frontend/src/lib/i18n/{en,tr,de}.json`

**Checkpoint**: The Cost view shows tested estimates, and each links to a formula anchor.

---

## Phase 7: User Story 8 - Learn how the estimates are calculated (Priority: P1 documented formulas; P3 interactivity)

**Goal**: A "How we calculate" page with an anchor for every formula, its inputs, assumptions and worked GPT-2 small examples, computed by the same functions the site uses.

**Independent Test**: Follow every EstimateLabel link: it lands on the matching anchor. Recompute by hand from the shown formula and get the same value.

### Tests for User Story 8 ⚠️

- [ ] T088 [P] [US8] Write `frontend/tests/unit/model/formulas.test.ts`: every `formulaId` emitted by `params.ts`, `flops.ts` and `kvcache.ts` (enumerate them by calling each function) exists in the `FORMULAS` registry, and every registry entry has title, expression and input keys in all locales
- [ ] T089 [P] [US8] Write `frontend/tests/e2e/method.spec.ts` (`@method`): from the Cost and Architecture views, clicking each EstimateLabel opens `view=method` with the matching element focused and in view; the worked-example values equal the function outputs; in the interactive section, changing n and t updates the results immediately

### Implementation for User Story 8

- [ ] T090 [US8] Implement `frontend/src/lib/model/formulas.ts`: the `FORMULAS` registry keyed by formula id. Each entry has `{ id, titleKey, expression (plain-text/MathML-free notation, e.g. "6 · d² · n"), inputs: ('n_embd'|'n_layer'|'n_head'|'n_inner'|'vocab_size'|'n_positions'|'n'|'t')[], worked(config, {n, t}) -> CostEstimate | number }`. `worked` calls `params.ts`/`flops.ts`/`kvcache.ts`, never duplicates the math.
- [ ] T091 [US8] Create `frontend/src/views/Method.svelte` (FR-028, US8-1/2):
  - ViewIntro.
  - An "Assumptions" section:
    - forward pass only; one multiply-add = 2 FLOPs; matmuls only
    - excluded: bias adds, layer norm, softmax, GELU, residual adds
    - the embedding lookup costs 0
    - the position add is a separate item
    - causal attention counts only unmasked entries
    - the LM head runs only for the predicted position
    - prefill vs decode with a KV cache
    - float32 for the KV cache
    - `n_inner: null` ⇒ 4·d and the LM head tying, with a link to the HF GPT-2 source
  - One `<section id="{formulaId}" tabindex="-1">` per formula: expression, named inputs with their config source, and a worked GPT-2 small example with values from `worked()` and the config values shown.
  - On load or hash change, focus the targeted section.
- [ ] T092 [US8] (P3) Add an interactive panel to `frontend/src/views/Method.svelte` (FR-028 Could, US8-3): labelled number inputs for input tokens n (1..`limits.max_input_tokens`) and context length t (1..`nPositions`). Values are clamped with an inline translated validation message. Every worked example re-renders immediately from the same functions, and an `aria-live` summary announces the changed totals.
- [ ] T093 [US8] Add all US8 strings (assumption texts, formula titles, input labels, worked-example captions) to `frontend/src/lib/i18n/{en,tr,de}.json`

**Checkpoint**: Every estimate on the site is traceable to a documented, tested formula.

---

## Phase 8: User Story 5 - Use the site in my own language (Priority: P1)

**Goal**: Correct default language, a language switch on every view without losing state, and English technical terms with localized explanations.

**Independent Test**: Browser locales tr-TR, de-DE, en-US and fr-FR give tr, de, en and en. Switching language on each main view keeps example, view, layer, head, step and theme, and no raw key appears (quickstart Q10).

### Tests for User Story 5 ⚠️

- [ ] T094 [P] [US5] Write `frontend/tests/unit/i18n/resolveLocale.test.ts`. Precedence: "`lang` in URL > stored preference (localStorage) > browser `navigator.languages` (first of `tr`/`de`/`en` matched by primary subtag) > `en`". Cases: `['fr-FR','de-DE']` → de; `['fr']` → en; an invalid URL lang is ignored and flagged as replaced; a throwing storage is ignored.
- [ ] T095 [P] [US5] Write `frontend/tests/e2e/i18n.spec.ts` (`@i18n`):
  - **Default language**: contexts with `locale` tr-TR, de-DE, en-US and fr-FR each get the expected language, and `<html lang>` matches.
  - **Switching**: on each built main view, set a non-default example/layer/head/step/theme, switch to each language, and assert the state is unchanged and the visible text changed.
  - **Completeness**: assert that no `⟦` missing-key marker appears.
  - **Terms**: glossary terms render in English with a localized explanation.

### Implementation for User Story 5

- [ ] T096 [US5] Implement `frontend/src/lib/i18n/resolveLocale.ts`: `resolveLocale({ urlLang?, stored?, navigatorLanguages }) -> { locale, urlLangInvalid: boolean }` per T094, used by `main.ts` at startup (US7 passes `urlLang`)
- [ ] T097 [US5] Create `frontend/src/components/LanguageSwitch.svelte` and mount it in the App header (FR-029):
  - Options are labelled in their own language (English, Türkçe, Deutsch) with `lang` attributes.
  - It calls `setLocale` and persists `itt.lang` in localStorage (try/catch).
  - It updates `document.documentElement.lang` and leaves every other `viewState` field untouched.
- [ ] T098 [US5] Do a translation pass over `frontend/src/lib/i18n/{tr,de}.json` and `glossary.{tr,de}.json`:
  - plain language, no ML jargon beyond the glossary terms
  - correct locale number formatting is used everywhere (audit all views for `toFixed`/raw number rendering and replace with `format.ts`)
  - each view's first glossary term occurrence uses `<Term>` (FR-030; audit all views)

**Checkpoint**: The site is complete in en, tr and de.

---

## Phase 9: User Story 6 - Try my own text with live mode (Priority: P2)

**Goal**: An opt-in live mode backed by the stateless CPU service. It has the same views as example mode, translated wake-up and error states, and never stores the text.

**Independent Test**: With the service running, each example's text in live mode gives identical tokens and probabilities within 1e-4 (Q6, `@fullstack`). With the service stopped, a translated message appears within 10 s of the detected failure and example mode keeps working (Q7).

### Tests for User Story 6 (backend) ⚠️

- [ ] T099 [P] [US6] Write `backend/tests/contract/test_api_contract.py`:
  - Load `contracts/inference-api.openapi.yaml` (PyYAML) and `contracts/example-data.schema.json` into a `referencing.Registry` so `./example-data.schema.json#/$defs/...` resolves. Validate with `Draft202012Validator`.
  - Validate the real TestClient responses for `GET /api/v1/health`, `POST /api/v1/runs`, `POST /api/v1/attention` and `POST /api/v1/token-embeddings`.
  - Validate each error code: `empty_input`, `input_too_long_chars`, `input_too_long_tokens`, `invalid_request`, `rate_limited`, `busy`, `model_loading` (model not yet loaded), and `internal` (monkeypatch `compute_run` to raise).
  - Assert the status codes and the `Retry-After` header for 429/503.
  - Also validate every file in `contracts/fixtures/api/` against its schema.
- [ ] T100 [P] [US6] Write `backend/tests/integration/test_limits.py`. Check that:
  - 64 input tokens → 200; 65 → 422 `{"error":{"code":"input_too_long_tokens","params":{"limit":64,"actual":65}}}`, and the model is never called (spy on `compute_run`)
  - 1,000 code points (including astral emoji) → passes the char check; 1,001 → 422 `input_too_long_chars`
  - whitespace-only text → 422 `empty_input`
  - `max_new_tokens` = `limits.max_new_tokens + 1` → 400 `invalid_request` with `field: "max_new_tokens"`
  - `token_ids` of length 129, an id ≥ `vocab_size` and layer 0 or `n_layer + 1` → 400
  - the step cap is `min(max_new_tokens, n_positions − n_input)`
  - all limit values come from `contracts/limits.json`
- [ ] T101 [P] [US6] Write `backend/tests/integration/test_live_matches_examples.py` (SC-002, marker `model`): for each example in `frontend/public/data/examples/`, POST `/api/v1/runs` with its text and `max_new_tokens = core.run.steps`. Assert the tokens are identical and every candidate probability is within 1e-4 of `core.json`. Also check that `/attention` for layer 1 dequantizes to within 1e-3 of the example's `attention-L01.u16`.
- [ ] T102 [P] [US6] Write `backend/tests/unit/test_ratelimit.py`:
  - token-bucket refill and burst (`/runs` 6/min burst 3; detail 60/min burst 20)
  - entries expire after 10 min (injectable clock)
  - the client key is the first `X-Forwarded-For` hop, else the socket peer
  - concurrency gate: semaphore 1, at most 8 waiting, a 30 s queue wait, overflow → `busy` with `retry_after_s`
  - env overrides are honored
- [ ] T103 [P] [US6] Write `backend/tests/privacy/test_canary.py` (FR-012, Q9):
  - Generate a unique canary (`f"canary-{uuid4()}"`). Send it as text through `/runs`, including the success, `empty_input` (canary with whitespace), `input_too_long_chars`, `input_too_long_tokens`, `invalid_request` (malformed JSON containing the canary) and `internal` (monkeypatched exception whose message contains the canary) paths.
  - Capture all log records (`caplog` at DEBUG on the root, `uvicorn`, `uvicorn.access`, `fastapi` and `app`) and stdout/stderr (`capfd`).
  - Assert the canary appears in no log record, no captured output and no response body or header.

### Implementation for User Story 6 (backend)

- [ ] T104 [US6] Implement `backend/app/schemas.py`: Pydantic v2 models with `extra="forbid"` mirroring the contract: `RunRequest {text: str (max_length 4000), max_new_tokens: int ≥ 0}`, `TokenIdsRequest {token_ids: list[int ≥ 0], 1..128 items}`, `AttentionRequest {token_ids, layer: int ≥ 1}`, `EncodedArray`, `Health`, `Limits`, `RunResponse {model, run}`, `AttentionResponse`, `TokenEmbeddingsResponse`, `ErrorBody`
- [ ] T105 [US6] Implement `backend/app/errors.py`:
  - `ApiError(code, http_status, params)` with this mapping:

    | Code | HTTP |
    |---|---|
    | `empty_input` | 422 |
    | `input_too_long_chars` | 422 |
    | `input_too_long_tokens` | 422 |
    | `invalid_request` | 400 |
    | `rate_limited` | 429 |
    | `busy` | 503 |
    | `model_loading` | 503 |
    | `internal` | 500 |

  - Add the `Retry-After` header for 429 and 503.
  - Handlers:
    - `RequestValidationError` → 400 `invalid_request` with `params.field` = the last string `loc` element filtered to `^[a-z_]+$` (never `input`, never `msg`)
    - Starlette `HTTPException` → `invalid_request`
    - generic `Exception` → 500 `internal`, logging only `type(exc).__name__` and the raising module:lineno from the traceback's last frame, never `str(exc)` or locals
- [ ] T106 [P] [US6] Implement `backend/app/ratelimit.py` (~40 lines, no dependency) per T102. Settings come from env vars `RL_RUNS_PER_MIN`, `RL_RUNS_BURST`, `RL_DETAIL_PER_MIN`, `RL_DETAIL_BURST`, `GATE_MAX_WAITING`, `GATE_QUEUE_WAIT_S`. Expose `check_rate(request, bucket)` raising `ApiError('rate_limited')` and `async with model_gate():` raising `ApiError('busy')`. The keys stay in memory only and are never logged.
- [ ] T107 [P] [US6] Implement `backend/app/logging.py`: middleware that logs one line `method route_template status duration_ms` using `request.scope["route"].path` (falling back to `"unmatched"`). It records no query, IP, headers or body.
- [ ] T108 [US6] Implement `backend/app/api.py` (APIRouter prefix `/api/v1`):
  - **`GET /health`**: `{status:"ok", api_version: <openapi info.version>, model:{id, revision, versions}, limits}`. Returns 503 `model_loading` until the model is loaded.
  - **`POST /runs`**, checked in this order:
    1. rate limit
    2. `text.strip() == ""` → `empty_input`
    3. `len(text) > max_input_chars` (code points) → `input_too_long_chars {limit, actual}`
    4. `max_new_tokens > limits.max_new_tokens` → `invalid_request {field:"max_new_tokens"}`
    5. `tokenize(text)` (the only tokenization site); `len > max_input_tokens` → `input_too_long_tokens {limit, actual}` before any model call

    Then, inside `model_gate()`, `await run_in_threadpool(compute_run, ids, min(max_new_tokens, n_positions − n_input))` → `{model, run: run.to_core()}`.
  - **`POST /attention`**: validate `len(token_ids) ≤ max_input_tokens + max_new_tokens` and `≤ n_positions`, each id < `vocab_size`, `layer ≤ n_layer`. Return `{layer, n_tokens, weights: encoded_array(pack_causal(quantize_u16(...)), 'uint16', 1/65535)}`.
  - **`POST /token-embeddings`**: the same id validation; return `{unique_ids, embeddings: encoded_array(rows, 'float32')}`.
- [ ] T109 [US6] Implement `backend/app/main.py`:
  - FastAPI app with `docs_url=None`, `redoc_url=None` and a lifespan that loads the model once and flips a `ready` flag.
  - `CORSMiddleware` with `allow_origins` from env `ALLOWED_ORIGINS` (comma-separated; empty ⇒ none), methods GET/POST, header `content-type`.
  - `GZipMiddleware(minimum_size=1000)`, the logging middleware and the error handlers.
  - Uvicorn access log disabled: document `--no-access-log` and set `logging.getLogger("uvicorn.access").disabled = True`.
  - **README**: add the local backend run command (`uv run uvicorn app.main:app --port 7860 --no-access-log`) and `ALLOWED_ORIGINS` to "Run locally", plus how to point the frontend at it with `VITE_API_BASE_URL`.
- [ ] T110 [P] [US6] Create `backend/Dockerfile`:
  - `python:3.12-slim`; install uv; `uv sync --frozen --no-dev`.
  - `ENV HF_HOME=/app/.cache/huggingface`; `RUN uv run python -m app.core.model --download` (bakes the pinned weights).
  - At runtime: `ENV HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 LIMITS_PATH=/app/contracts/limits.json`.
  - `COPY contracts/ /app/contracts/`, staged by the deploy script.
  - Non-root user; `EXPOSE 7860`; `CMD uv run uvicorn app.main:app --host 0.0.0.0 --port 7860 --no-access-log`.

  Also create `backend/README.md` with the HF Space front matter (`title`, `sdk: docker`, `app_port: 7860`) and a short description with a privacy statement.
- [ ] T111 [US6] Implement `backend/tools/record_api_fixtures.py`: use TestClient against the real app to write `contracts/fixtures/api/health.json`, `run.json` (text "The quick brown fox", `max_new_tokens` 3), `attention.json` (layer 1 of that run), `token-embeddings.json` and one `error-<code>.json` per error code (`{status, headers?, body}`). Run it and commit the fixtures. T099 validates them. Add `uv run python -m tools.record_api_fixtures` to the README.

### Tests for User Story 6 (frontend) ⚠️

- [ ] T112 [P] [US6] Write `frontend/tests/contract/api-client.test.ts`. Ajv-validate every `contracts/fixtures/api/*.json` body against the OpenAPI component schemas, extracted from the YAML with the external `$ref` resolved. Then drive `client.ts` with a mocked `fetch` serving each fixture and check:
  - success responses parse into typed objects
  - each `error-<code>` maps to an `ApiError` with the same code and params
  - an abort after 60 s → `timeout`; a fetch rejection on a model request (`/runs`, `/attention`, `/token-embeddings`) → `network`
  - health polling follows the R13 classification table (use fake timers and a mocked `fetch` that distinguishes `mode: 'no-cors'` calls):
    - a non-JSON health reply (HF "starting" HTML) → waking, then `wake_timeout` after `limits.wait_limit_s`
    - CORS fetch rejects but the `no-cors` probe resolves (opaque) → waking, not `network`; still waking after 30 s of this
    - CORS fetch and probe both reject twice in a row → `network` within 10 s of the start
    - one unreachable attempt, then a waking attempt, then an unreachable one → still waking (the counter resets)
    - the probe request carries no body and no credentials
  - `onWaking` fires on the first waking attempt
  - a revision ≠ `index.json` revision → `version_mismatch`
  - a truncated/invalid body → `invalid_response`, and nothing partial is returned
- [ ] T113 [P] [US6] Write `frontend/tests/e2e/live.spec.ts` (`@live`), using `page.route` mocks fed by `contracts/fixtures/api/` and building with `VITE_API_BASE_URL=http://api.test`. Check:
  - enter live mode → the text field with the hint, English note, privacy note and stated limits (64 tokens / 64 steps)
  - run → every explore view and the Cost view render, and stepping works
  - a text ending in `?` shows the tip without blocking
  - the health reply is HTML for 2 polls, then OK → the "waking up" status with Cancel, then the result
  - the health reply is HTML **without** `access-control-allow-origin` (so the browser's CORS fetch fails but the `no-cors` probe gets an opaque response) for 2 polls, then OK → the "waking up" status, not "unavailable", then the result
  - Cancel returns to idle
  - all routes abort with `connectionrefused` → a translated unavailable message within 10 s of pressing Run, "Back to examples" works, and example views still render
  - a 429 and a 503 busy each show a translated message with retry seconds
  - a 422 `input_too_long_tokens` shows the limit and the actual count
  - switching language during a pending request → the result and messages appear in the new language
  - at the last step of an example, "Continue in live mode" re-runs the example text in live mode
- [ ] T114 [P] [US6] Write `frontend/tests/e2e/privacy.spec.ts` (`@privacy`). Type a unique canary in live mode (mocked API) and run it. Assert the canary is absent from `page.url()`, every request URL, `localStorage`, `sessionStorage`, `indexedDB.databases()` names and `document.cookie`, and is present only in the POST body to `/api/v1/runs`.
- [ ] T115 [P] [US6] Write `frontend/tests/e2e/fullstack.spec.ts` (`@fullstack`, project `fullstack`, real backend on :7860, `ALLOWED_ORIGINS=http://localhost:4173`). For two examples (one short, one long), entering the example text in live mode gives tokens identical to example mode. The Prediction details probabilities are within 1e-4 of the example's, and stepping, Attention and Embeddings load via the API.

### Implementation for User Story 6 (frontend)

- [ ] T116 [US6] Implement `frontend/src/lib/api/client.ts`, using the types from `src/generated/api-types.ts`:
  - `getHealth(signal)` has a 5 s timeout per attempt. `waitForService({signal, onWaking})` polls every 3 s and classifies each attempt per the R13 table:
    - 200 with a valid `Health` body → ready
    - non-200, non-JSON or a 5 s timeout → waking
    - a rejected CORS fetch → call `probeReachable(url, signal)`, which is `fetch(url, { mode: 'no-cors', cache: 'no-store', credentials: 'omit' })`; if it resolves, waking, else unreachable

    `onWaking` fires on the first waking attempt. Two consecutive unreachable attempts end the wait with `network`; any other result resets the count. If `limits.wait_limit_s` elapses first → `wake_timeout`. When ready, it compares `health.model.revision` with the `index.json` revision (→ `version_mismatch`).
  - `createRun(text, signal)` always sends `max_new_tokens = limits.max_new_tokens`. Add `getAttention(ids, layer, signal)` and `getTokenEmbeddings(ids, signal)`.
  - Every request has a 60 s ceiling via `AbortController`. The body is read fully (`await res.text()`) and then parsed and validated with hand-written guards (`assertRunCore` etc.) before return.
  - Errors are typed `ApiError { code, params }`, with client codes `timeout|network|wake_timeout|version_mismatch|invalid_response`.
  - Text is sent only in POST bodies, and nothing is logged.
- [ ] T117 [US6] Implement `frontend/src/lib/data/liveSource.ts`: `createLiveRun(response, client) -> RunData` with `source: 'live'`. `getAttention(layer)` calls the API with `tokens.map(t => t.id)` and caches per layer in memory. `getTokenEmbeddings()` is cached the same way. Position embeddings use the shared static shards. Results are decoded with `decodeEncodedArray`.
- [ ] T118 [US6] Implement `frontend/src/lib/state/liveSession.svelte.ts`. The state machine is "`idle → validating (char cap) → waking? → running → ready | error(code)`; `ready → idle` on new text; any state `→ idle` on cancel; `error → example mode` on 'back to examples'". The live text lives only in this module's `$state` (memory) and is never written to storage or the URL; the module has no import of `url.ts` or storage helpers. Add `cancel()` (AbortController) and `runText(text)`.
- [ ] T119 [US6] Create `frontend/src/components/live/LiveMode.svelte` (lazy chunk, FR-008/011/013, US6-1..6):
  - **Input**: a labelled `<textarea>` with a hint that GPT-2 continues text and works best in English, a privacy note that the text is never stored, and the limits from `limits.ts` (64 tokens, 64 steps).
  - **Character cap**: a code-point counter `[...text].length` / 1000; Run is disabled for empty or whitespace-only text or > `max_input_chars`.
  - **Chat tip**: shown when the trimmed text ends with `?` or matches `/^(what|who|why|how|when|where|can you|could you|please|tell me|write)\b/i`; it does not block the run.
  - **Non-English note**: after a run, if the text contains a letter outside ASCII (`/\p{L}/u` and non-ASCII), explain that such text splits into many small tokens and gives weaker continuations.
  - **Status and errors**: a "Waking up the model…" status with elapsed seconds and Cancel. Error messages come from `error.<code>` with params, plus "Back to examples". `wake_timeout` adds a link to the Space page.
  - **Results**: on success, pass the live `RunData` to the same views and controls as example mode (FR-009).
- [ ] T120 [US6] Create `frontend/src/components/ModeSwitch.svelte` and wire it in `frontend/src/App.svelte`:
  - Rendered only when `VITE_API_BASE_URL` is non-empty.
  - Switching to live dynamically imports `LiveMode.svelte` inside `<svelte:boundary>`; any thrown error shows a translated message and keeps example mode usable (Principle V).
  - On entering live mode, call `waitForService`; `version_mismatch` disables live mode with a message.
  - Switching back to example mode discards the live run and text.
- [ ] T121 [US6] Fill `GenerationControls.svelte`'s `liveOffer` slot (US1-7): when live mode is available and an example is at its last step, show "Continue in live mode". It switches to live mode, puts the example's original text in the field and runs it; generation can then go up to the live step limit.
- [ ] T122 [US6] Add all US6 strings to `frontend/src/lib/i18n/{en,tr,de}.json` and check T034 passes: live hints, privacy note, limit statements, chat tip, non-English note, waking status, Cancel, Back to examples, and `error.<code>` for every server and client code with `{limit}`, `{actual}` and `{retry_after_s}` placeholders.

**Checkpoint**: Live mode works end to end, and every failure is contained.

---

## Phase 10: User Story 7 - Share exactly what I'm looking at (Priority: P2)

**Goal**: The URL always encodes example, view, layer, head, step and language. Opening it restores that exact state, and invalid parts fall back to valid defaults with a notice.

**Independent Test**: Set a non-default state, copy the link, and open it in a fresh browser context; the state is identical. Invalid links normalize with a notice (Q10, SC-010).

### Tests for User Story 7 ⚠️

- [ ] T123 [P] [US7] Write `frontend/tests/unit/state/url.test.ts` (contract `contracts/url-state.md`):
  - **Round trip**: `parse(serialize(s)) == s` over a matrix of every example × views {tokens, attention, cost, method} × layer {1, nLayer} × head {1, nHead} × step {0, last} × lang {en, tr, de}.
  - **Key order** is `mode, ex, view, layer, head, step, lang`, and `ex` and `lang` are always written.
  - **Normalization**:
    - unknown keys are ignored
    - unknown `ex`/`view`/`lang` → the default
    - `layer=99` → nLayer
    - `head=0` → 1
    - `step=999` → the last step
    - `step=abc` → 0
    - each replacement is listed in `replaced`
  - **Live mode**: `mode=live` ignores `ex`, and `serialize` has no parameter that accepts text.
- [ ] T124 [P] [US7] Write `frontend/tests/e2e/share.spec.ts` (`@share`):
  - set `ex=long-…`, `view=attention`, `layer=5`, `head=3`, `step=3`, `lang=de`, then click "Copy link" (grant clipboard permissions)
  - open the link in a new browser context with locale `tr-TR`: the identical state and German UI (the link's lang overrides the browser)
  - an invalid link (`layer=40&step=999&view=nope`) → a valid fallback state, the notice is shown once, and the URL is rewritten
  - Back after a view change returns to the previous view
  - in live mode, "Copy link" explains that the text is not included

### Implementation for User Story 7

- [ ] T125 [US7] Implement `frontend/src/lib/state/url.ts` per `contracts/url-state.md`. `parseUrl(search, ctx: { exampleIds, nLayer, nHead }) -> { state: Partial<ViewState>, replaced: string[] }` and `clampStep(step, run) -> { step, replaced }` (applied after the example's `core.json` loads). `serializeUrl(state: Pick<ViewState,'mode'|'exampleId'|'view'|'layer'|'head'|'step'|'lang'>, hash?) -> string` writes the keys in contract order, omits defaults except `ex` and `lang`, and never accepts live text.
- [ ] T126 [US7] Wire URL sync in `frontend/src/main.ts` and `frontend/src/App.svelte`:
  - At startup, parse the URL, pass `urlLang` to `resolveLocale`, apply the state, clamp the step after the core loads, `history.replaceState` the normalized URL, and raise the notice if anything was replaced.
  - On state change, `view`/`ex`/`mode` changes call `history.pushState` and `layer`/`head`/`step`/`lang` changes call `replaceState`.
  - A `popstate` listener re-applies the parsed state.
  - The fragment is preserved for `view=method`.
- [ ] T127 [P] [US7] Create `frontend/src/components/CopyLinkButton.svelte` (US7-1/4). In example mode it copies `location.href` (already normalized) via `navigator.clipboard.writeText`, falling back to a read-only selected `<input>`, and confirms with a polite `aria-live` message. In live mode it does not copy; it explains that the visitor's own text is never put into links, to protect their privacy.
- [ ] T128 [P] [US7] Create `frontend/src/components/Notice.svelte`: a one-time, dismissible, polite `aria-live` notice "Part of the link could not be restored", shown in the App notice region
- [ ] T129 [US7] Add all US7 strings (copy link, copied confirmation, live-share explanation, link notice) to `frontend/src/lib/i18n/{en,tr,de}.json`

**Checkpoint**: All user stories are complete.

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Release completeness of the gates that have run in CI since Phase 2 (T049a–T049d), remaining e2e matrices, deployment, documentation and release validation

- [ ] T130 [P] Extend `frontend/tests/e2e/a11y.spec.ts` (from T049b; FR-044, SC-007) for release:
  - assert that no view root carries `data-placeholder`, so all 8 main views are real
  - add the live-mode states (mocked API, as in T113) to the matrix: input form, waking status and an error message, × theme × lang
  - the zero-violations expectation is unchanged
- [ ] T131 [P] Write `frontend/tests/e2e/keyboard.spec.ts` (`@keyboard`, SC-006). Using the keyboard only (no `click`, no `mouse`), cover the FR-043 scenarios: open an example, step through layers, change the attention head, generate the next token, switch language, open a shared link, use live mode (mocked), and use live mode with the service unavailable. On each focus stop, assert the focused element has a visible focus indicator (computed `outline-style` ≠ `none` or a box-shadow ring).
- [ ] T132 [P] Write `frontend/tests/e2e/responsive-motion.spec.ts` (`@responsive`). On the `mobile` project (360 px), check that every main view has `document.documentElement.scrollWidth ≤ clientWidth` (FR-039). With `page.emulateMedia({ reducedMotion: 'reduce' })`, generate a token and switch views, then assert `document.getAnimations().length === 0` and that the same final DOM state is reached (FR-036).
- [ ] T133 [P] With every view built and the live chunk in place, confirm that `lhci` (config from T049c) still passes all four assertions (performance ≥ 0.9, LCP ≤ 3,000 ms, TBT ≤ 200 ms, total size < 2,000,000 B) and that `check:budgets` passes. If anything fails, fix the build. A budget may only be raised after a constitution amendment (Principle VII).
- [ ] T134 [P] Extend `frontend/tests/unit/readme-doc-check.test.ts` (from T049a; Principle IX): also extract every `npm run …`, `npx …` and `uv run …` command from `specs/001-inside-the-transformer/quickstart.md` and assert each appears in the root `README.md`
- [ ] T135 [P] Extend `.github/workflows/frontend.yml` (from T049d):
  - pass `VITE_BASE` and `VITE_API_BASE_URL` from repo variables to `build`
  - make sure `test:e2e` runs the full default matrix (chromium + mobile, including @a11y, @keyboard, @i18n, @share, @privacy, @live, @responsive)
  - keep the Pages `deploy` job dependent on every check job
- [ ] T136 [P] Extend `.github/workflows/backend.yml` (from T049d) with a `fullstack` job that starts the backend and runs `npm run test:e2e:fullstack`
- [ ] T137 [P] Implement `backend/tools/deploy_space.py` (`--space <user>/<space>`, requires `HF_TOKEN`): stage `backend/` (excluding `.venv`, `tests`, `tools`, caches) plus `contracts/` into a temp dir, then `huggingface_hub.HfApi().upload_folder(repo_id=space, repo_type="space", folder_path=staging)`. Create `.github/workflows/space-deploy.yml` (manual `workflow_dispatch`, uses the `HF_TOKEN` secret). Add the deploy command, `HF_TOKEN` and `ALLOWED_ORIGINS` to the README "Deploy" section.
- [ ] T138 Do the final README review (Principle IX). The README has been kept current since T008a. Check that every section is complete and correct:
  - project overview and the two components
  - prerequisites (Node 22, Python 3.12, uv, optional Docker)
  - run locally, in example mode and with the backend (`VITE_API_BASE_URL`)
  - test: every `npm run`/`uv run` command from quickstart Q1–Q11
  - regenerate example data (generate → verify → `--check`; model revision pin)
  - deploy: GitHub Pages variables, `deploy_space.py`, `ALLOWED_ORIGINS`
  - CI and required status checks
  - privacy guarantees, budgets, and the contracts location

  T134 must pass.
- [ ] T139 Run quickstart Q1–Q7 and Q9–Q11 locally from a clean checkout (`npm ci`, `uv sync`) and fix any failure. Every command must pass as written in `specs/001-inside-the-transformer/quickstart.md`.
- [ ] T140 Deploy the frontend (Pages) and backend (Space) and run quickstart Q8 (wake-up behavior). Record under the R13 open item in `specs/001-inside-the-transformer/research.md`:
  - whether an API request alone wakes the sleeping Space; if it does not, confirm the `wake_timeout` message links to the Space page
  - whether the Space's start-up reply carries CORS headers for the Pages origin, and which R13 "waking" row the browser actually hit (check in DevTools: a readable HTML reply, or a CORS failure followed by an opaque `no-cors` probe)
  - that the deployed site shows "waking up", not "unavailable", while the Space starts
- [ ] T141 (Manual, SC-005) Run a usability session with ≥ 5 participants who have no ML background. The tasks are: pick an example; find which earlier token a chosen token attends to most in a given layer and head; generate two tokens; explain in their own words that the model predicts one token at a time. Record the protocol, results (≥ 4 of 5 within 10 minutes) and follow-ups in `specs/001-inside-the-transformer/usability-study.md`.
- [ ] T142 Do a final constitution Quality Gates review: check all 9 gates from `.specify/memory/constitution.md` against the implementation and CI results, and record pass/fail with evidence links in `specs/001-inside-the-transformer/checklists/quality-gates.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none. T001 runs first, since everything references `contracts/` at the repo root. T003 + T004 → T008a (the README documents their commands).
- **Foundational (Phase 2)**: depends on Setup and BLOCKS all stories. Inside the phase:
  - T009 → T013 → T014
  - T011 → T013
  - T013 + T015 → T016 → T017 → T018 → T019
  - T017 → T020, T025, T028, T029 (they need the generated config and data)
  - T020 → T026 → T027 → T028
  - T032 → T033 → T034
  - T036 → T046
  - T039–T045 → T046
  - T008a → T049a
  - T006 + T046 → T049b
  - T046 → T049c
  - T047 + T049a + T049b + T049c (+ T017–T019 for the backend workflow) → T049d, the last task of the phase
- **User stories (Phase 3+)**: all depend on Foundational, including T049d. Every story merges only with CI green.
- **Polish (Phase 11)**: depends on all the stories you want to ship. T130–T133 need every main view to exist. T134–T136 extend files created in T049a and T049d.

### User Story Dependencies

| Story | Depends on | Notes |
|---|---|---|
| US1 (P1) MVP | Foundational | Adds the example picker and generation controls used by later stories |
| US2 (P1) | Foundational + US1 (picker, step controls) | Independently testable once US1's shell exists |
| US3 (P1) | Foundational only | Config-only view; can be built in parallel with US1 |
| US4 (P1/P2/P3) | Foundational + US1 (step); links target US8 anchors | Can start in parallel with US8 |
| US8 (P1/P3) | Foundational; uses `params.ts`/`flops.ts`/`kvcache.ts` from US3/US4 | Build right after US4 |
| US5 (P1) | Foundational; its e2e covers whichever views exist | Best done after US1–US4 + US8 so every view is covered |
| US6 (P2) | Foundational + US1 (views, controls); best after US2 | Backend tasks T099–T111 can start right after Phase 2 |
| US7 (P2) | Foundational + US1 + US2 (layer/head) + US5 (`resolveLocale`) | |

### Within Each User Story

- Write the tests first and confirm they fail (unit before e2e)
- Libraries and models before components, components before views, views before wiring, wiring before strings
- Each story's i18n task must leave T034 (completeness) green
- Each story leaves CI green: its views pass the `@a11y` suite (T049b) as soon as they replace their placeholders, budgets and Lighthouse hold, and the README doc check (T049a) passes

### Parallel Opportunities

- **Phase 1**: T005–T008 in parallel after T004; T008a after T003 and T004.
- **Phase 2**:
  - Backend T010, T011, T012 and T015 run in parallel with T009.
  - Frontend T020–T025, T030, T031, T033, T035 and T047–T049 run in parallel once T017 has produced the config and data.
  - Components T039–T042 and T045 run in parallel.
  - Gates T049a, T049b and T049c run in parallel; T049d comes after them.
- **After Phase 2**:
  - US3 and the US6 backend work (T099–T111) can run alongside US1.
  - US4's `flops.ts`/`kvcache.ts` (T081, T082) and US8's registry work can run alongside US2.
- **Within stories**: every task marked [P] touches its own file.

---

## Parallel Example: User Story 2

```bash
# Tests first (parallel):
Task: "T060 [US2] embeddings unit test in frontend/tests/unit/data/embeddings.test.ts"
Task: "T061 [US2] e2e inside-machine spec in frontend/tests/e2e/inside-machine.spec.ts"

# Independent building blocks (parallel):
Task: "T062 [US2] buildEmbeddingVectors in frontend/src/lib/data/embeddings.ts"
Task: "T063 [US2] VectorStrip in frontend/src/components/VectorStrip.svelte"
Task: "T064 [US2] VectorTable in frontend/src/components/VectorTable.svelte"
Task: "T066 [US2] LayerSelector in frontend/src/components/LayerSelector.svelte"
Task: "T067 [US2] HeadSelector in frontend/src/components/HeadSelector.svelte"
Task: "T068 [US2] ChangeBars in frontend/src/components/ChangeBars.svelte"

# Then sequential: T065 Embeddings view → T069 Blocks view → T070 Heatmap → T071 Attention view → T072 strings
```

## Parallel Example: User Story 6 (backend)

```bash
Task: "T099 contract tests in backend/tests/contract/test_api_contract.py"
Task: "T100 limits tests in backend/tests/integration/test_limits.py"
Task: "T101 parity test in backend/tests/integration/test_live_matches_examples.py"
Task: "T102 rate-limit tests in backend/tests/unit/test_ratelimit.py"
Task: "T103 privacy canary in backend/tests/privacy/test_canary.py"
# then T104 → T105 → (T106 ∥ T107) → T108 → T109 → (T110 ∥ T111)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup
2. Phase 2: Foundational. The critical path is the backend core → generated and **verified** example data (T019) → frontend libraries and shell → CI with all automated gates (T049d).
3. Phase 3: US1
4. **STOP and VALIDATE**: quickstart Q1 + Q2; `@example-mode` passes with the network blocked; both CI workflows are green (budgets, Lighthouse incl. LCP/TBT, `@a11y` on the built views, README doc check)
5. Deploy to GitHub Pages with `VITE_API_BASE_URL` unset, through the T049d `deploy` job, which runs only after every check passes. The README already describes how to run, test, regenerate and deploy. The site is already useful without a server (Principle V).

### Incremental Delivery

1. Setup + Foundational → verified data, app shell, README and CI gates
2. US1 → MVP (tokens + prediction, stepping)
3. US2 → embeddings, blocks, attention ("open the machine")
4. US3 → architecture with exact parameter counts
5. US4 (P1 part) + US8 (static) → tested estimates with documented formulas; then US4 P2 chart and P3 KV, and US8 P3 interactivity
6. US5 → translation pass and language switch
7. US6 → live mode (backend + frontend); deploy the Space
8. US7 → shareable links
9. Polish → release completeness of the a11y suite, the keyboard/responsive matrices, final Lighthouse and README review, CI extensions, release validation (T139–T142)

### Parallel Team Strategy

After Phase 2:

| Developer | Work |
|---|---|
| A | US1 → US2 → US7 |
| B | US3 → US4 → US8 |
| C | US6 backend (T099–T111), then the US6 frontend once US1 lands |
| D | US5 translation pass, then the Polish e2e matrix |

---

## Notes

- [P] means a different file and no dependency on an unfinished task. [USn] maps a task to its spec story.
- Never hand-edit generated files (`frontend/public/data/**`, `frontend/src/generated/**`, `frontend/tests/reference/param-shapes.json`, `contracts/fixtures/**`). Regenerate them with T016/T023/T111.
- Every new user-facing string goes into en, tr and de in the same task (Principle III).
- Every new or changed run/test/deploy/regenerate command goes into the README in the same task (Principle IX); T049a enforces it.
- Every new dependency gets a justification row in plan.md first (Principle VIII).
- No code path may persist or log live text (Principle IV). The T103/T114 canaries guard this.
- Stop at any checkpoint to validate the story on its own.
