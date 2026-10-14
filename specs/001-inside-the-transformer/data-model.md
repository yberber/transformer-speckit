# Data Model: Inside the Transformer

**Feature**: `001-inside-the-transformer` | **Date**: 2026-10-14 | **Plan**: [plan.md](./plan.md)

Entities follow the spec's Key Entities. Wire formats are defined in
[contracts/](./contracts/); this document defines meaning, relationships and validation rules.
Symbols: d = `n_embd`, L = `n_layer`, H = `n_head`, f = MLP size, V = `vocab_size`,
P = `n_positions` — all read from **ModelConfig**, never written as literals in code.

```text
ModelConfig ─┬─> ParamGroup* (Architecture view)          ┌─> Prediction (per step)
             ├─> CostEstimate* (Cost, How we calculate)    │
             └─> limits check (P)                          │
Example ──1:1──> Run ──1:N──> Token ──┬─ position ─> EmbeddingVectors
                  │                   └─ color (by position)
                  ├──1:L──> LayerSnapshot (change % per token, attention per head)
                  └── GenerationStep k = prefix view (n_input + k tokens)
ViewState ──> selects Run, step, layer, head, view, lang, theme
GlossaryTerm, Locale catalogs ──> all UI text
```

---

## ModelConfig

The official GPT-2 small `config.json` of the pinned revision, copied verbatim by the generator.

| Field (source key) | Meaning | Used for |
|---|---|---|
| `n_layer` | number of transformer blocks (L) | Blocks/Attention layer range, params, FLOPs |
| `n_head` | attention heads per block (H) | Attention head range; d_head = d / H |
| `n_embd` | hidden size (d) | vector lengths, shapes, FLOPs |
| `n_inner` | MLP size; `null` ⇒ 4·d (HF GPT-2 semantics) | MLP shapes, FLOPs |
| `vocab_size` | vocabulary size (V) | wte shape, LM head FLOPs, token ID validation |
| `n_positions` | max context length (P) | wpe shape, chart x-range, generation cap |
| `activation_function` | e.g. `gelu_new` ⇒ label "GELU (tanh approximation)" | MLP explanation |
| `layer_norm_epsilon` | layer-norm epsilon | How we calculate (informational) |
| `tie_word_embeddings` (default true) | LM head shares wte | Architecture panel, counted once |

**Validation**: loader rejects the config if any required field is missing, non-integer, ≤ 0, or
if `n_embd % n_head ≠ 0`. A unit test asserts that `paramGroups(config)` shapes equal
`tests/reference/param-shapes.json` (recorded from the real `state_dict`).

Also carried (not part of the HF config, recorded by the generator): `model_id`
(`openai-community/gpt2`), `revision` (commit SHA), `torch`/`transformers` versions.

## Limits (shared product limits)

From `contracts/limits.json`: `max_input_tokens` 64, `max_new_tokens` 64, `max_input_chars` 1000
(Unicode code points), `wait_limit_s` 60, `example_steps` 20. Effective live step cap =
`min(max_new_tokens, P − n_input)`.

## Example

| Field | Type | Rules |
|---|---|---|
| `id` | slug `^[a-z0-9-]{1,40}$` | unique, stable (used in URLs) |
| `length` | `short` \| `medium` \| `long` | exactly 2 of each (FR-003) |
| `text` | English string | written as text to continue; no trailing `?` |
| title | i18n key `example.<id>.title` | present in en, tr, de |
| `run` | Run | see below |

Token-count bands (input): short 5–15, medium 20–35, long 50–64 (≤ `max_input_tokens`).
Exactly six examples; one is the default (first in `index.json`).

## Run

The result of processing one input text: the shared shape for an Example's precomputed data and a
live-mode result.

| Field | Type | Rules |
|---|---|---|
| `source` | `example` \| `live` | |
| `tokens` | Token[] | length `n_input + steps` |
| `n_input` | int | 1 ≤ n_input ≤ `max_input_tokens` |
| `steps` | int | 0 ≤ steps ≤ cap (20 for examples, 64 live) |
| `stop_reason` | `step_limit` \| `eos` \| `context_limit` | why generation ended |
| `predictions` | Prediction[] | length `steps + 1` (index k = step k) |
| `layers` | LayerSnapshot[] | length L |
| `attention` | lazy, per layer | see LayerSnapshot |
| `embeddings` | lazy | see EmbeddingVectors |

**Invariant (causality)**: everything at token position i depends only on tokens 0..i, so
generation step k is the **prefix** of length `n_input + k` of every per-position array
(research R5). `tokens[n_input + k − 1]` (k ≥ 1) equals `predictions[k − 1].greedy` token.

**State transitions (live mode)**:
`idle → validating (char cap) → waking? → running → ready | error(code)`; `ready → idle` on new
text; any state `→ idle` on cancel; `error → example mode` on "back to examples". Example mode:
`loading core.json → ready | load_error` (per example, isolated).

## Token

| Field | Type | Rules |
|---|---|---|
| `id` | int | 0 ≤ id < V |
| `bytes` | uint8[] | raw byte-level BPE bytes, length ≥ 1 |
| `position` | int (implicit = index) | 0-based |
| `origin` | `input` \| `generated` | `position < n_input` ⇒ input |
| `color` | derived | `palette[position mod palette.length]`, same in every view and step |

Display: UTF-8 decode with `fatal: true`; on failure show byte values + "part of a character"
note. Leading space ⇒ `␣` marker, newline ⇒ `⏎` marker. EOS (id = `eos_token_id` from the
tokenizer config recorded by the generator) appears only in predictions, rendered as a labelled
marker; it is never appended (generation stops, `stop_reason = eos`).

## GenerationStep

Not stored; a view over the Run. Step k (0 ≤ k ≤ `steps`): tokens `[0, n_input + k)`, prediction
`predictions[k]`, attention rows/cols `[0, n_input + k)`, change % rows `[0, n_input + k)`.
Step 0 = input only. "Next token" enabled iff k < `steps`; at k = `steps` the end message depends
on `stop_reason` (and offers live mode for examples when available).

## Prediction

| Field | Type | Rules |
|---|---|---|
| `candidates` | {id, bytes, prob}[10] | sorted by prob desc, ties by id asc |
| `greedy` | = `candidates[0]` | marked in UI |

`prob` = softmax of final logits (float32, no temperature); 0 < prob ≤ 1. Tolerance vs reference:
1e-4 absolute.

## LayerSnapshot

One per block l ∈ [1, L] (1-based in UI and URLs, 0-based in arrays).

| Field | Type | Rules |
|---|---|---|
| `attn_change_pct` | float[T] | `‖a_i‖ / ‖x_i‖ · 100`, x = block input, a = attention output (after `c_proj`) |
| `mlp_change_pct` | float[T] | `‖m_i‖ / ‖y_i‖ · 100`, y = x + a, m = MLP output |
| `attention` | lazy: float[H][T(T+1)/2] | packed causal lower triangle, row-major: index of (i, j), j ≤ i = i(i+1)/2 + j |

Validation: change % ≥ 0, finite; attention ∈ [0, 1], each row sums to 1 ± (i+1)·2⁻¹⁶ after
dequantization. Tolerances: change % 0.1 % relative; attention 0.001 absolute.
T = `n_input + steps` (the full Run; prefixes give each step).

## EmbeddingVectors

Per token position i:

| Field | Source | Length |
|---|---|---|
| `token_embedding` | row `wte[tokens[i].id]` (from `embeddings-token.f32` or API, indexed via `unique_ids`) | d |
| `position_embedding` | row `wpe[i]` (shared static shards) | d |
| `sum` | `token_embedding + position_embedding`, computed in float32 in browser | d |

Tolerance: 0.1 % relative (stored float32 ⇒ exact). All d dimensions shown (no subset).

## ParamGroup (weight matrix / bias)

| Field | Type | Rules |
|---|---|---|
| `name` | HF state-dict name, e.g. `h.{l}.attn.c_attn.weight` | |
| `component` | `wte` \| `wpe` \| `ln_1` \| `attn.c_attn` \| `attn.c_proj` \| `ln_2` \| `mlp.c_fc` \| `mlp.c_proj` \| `ln_f` \| `lm_head` | diagram node |
| `layer` | int \| null | null for non-block groups |
| `shape` | int[] | computed from ModelConfig; HF Conv1D order (in × out), labelled so |
| `count` | int | product of shape |
| `share` | float | count / total; shares of counted groups sum to 1 |
| `tied_to` | name \| null | `lm_head.weight` → `wte.weight`; excluded from total |

Shapes from config: wte (V, d); wpe (P, d); ln_*.weight/bias (d); c_attn.weight (d, 3d), bias
(3d); attn.c_proj.weight (d, d), bias (d); c_fc.weight (d, f), bias (f); mlp.c_proj.weight (f, d),
bias (d). Buffers (`attn.bias` causal mask) are not parameters. Reference total: 124,439,808.

## CostEstimate

| Field | Type | Rules |
|---|---|---|
| `kind` | `flops` \| `bytes` | |
| `phase` | `prefill` \| `decode` \| `total` \| `kv_cache` | |
| `component` | `qkv` \| `attn_scores` \| `attn_weighting` \| `attn_out` \| `mlp` \| `pos_add` \| `lm_head` \| `all` | |
| `layer` | int \| null | null for non-layer components and totals |
| `inputs` | {n?, t?, config fields} | what the formula used |
| `value` | integer (exact, BigInt-safe ≤ 2⁵³) | |
| `formula_id` | anchor on "How we calculate" | every displayed estimate links here (FR-027) |
| `is_estimate` | always true | renders the "theoretical estimate" label |

Formulas: research R10. Step semantics: cost at step k ≥ 1 = decode(n_input + k); running total
= prefill(n_input) + Σⱼ₌₁..ₖ decode(n_input + j). KV cache bytes = 2·L·t·d·4.

## ViewState

| Field | URL key | Type / domain | Default | Shareable |
|---|---|---|---|---|
| mode | `mode` | `example` \| `live` | `example` | yes (text never) |
| example | `ex` | Example.id | first example | yes |
| view | `view` | `tokens` \| `embeddings` \| `blocks` \| `attention` \| `prediction` \| `architecture` \| `cost` \| `method` | `tokens` | yes |
| layer | `layer` | 1..L | 1 | yes |
| head | `head` | 1..H | 1 | yes |
| step | `step` | 0..Run.steps | 0 | yes |
| language | `lang` | `en` \| `tr` \| `de` | browser pref → `en` | yes |
| theme | — | `light` \| `dark` \| `system` | `system` | no (localStorage) |
| live text | — | string | "" | **never** (memory only) |

Normalization rules and precedence: [contracts/url-state.md](./contracts/url-state.md). Invalid
values clamp to nearest valid / default and raise a one-time "part of the link could not be
restored" notice.

## GlossaryTerm

| Field | Rules |
|---|---|
| `id` | `token`, `attention`, `embedding`, `layer`, `head`, `mlp`, `logit`, `probability-distribution`, `prefill`, `decode`, `flops`, `kv-cache` (minimum set, FR-030) |
| `term` | English, identical in all locales |
| `explanation` | one or two plain sentences per locale (en, tr, de), non-empty |

## Locale catalog

Flat `key → string` per locale; key set of `tr` and `de` must equal `en` exactly; no empty
values; ICU-free placeholders `{name}`; plural forms via `Intl.PluralRules` categories. Error
codes from the API map to keys `error.<code>`.

## ApiError (live mode)

| `code` | HTTP | `params` |
|---|---|---|
| `empty_input` | 422 | — |
| `input_too_long_chars` | 422 | `limit`, `actual` |
| `input_too_long_tokens` | 422 | `limit`, `actual` |
| `invalid_request` | 400 | `field` |
| `rate_limited` | 429 | `retry_after_s` |
| `busy` | 503 | `retry_after_s` |
| `model_loading` | 503 | — |
| `internal` | 500 | — |

Client-side codes (never from the server): `timeout`, `network`, `wake_timeout`,
`version_mismatch`, `invalid_response`. No error ever echoes input text.
