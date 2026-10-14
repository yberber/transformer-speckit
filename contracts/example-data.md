# Contract: Example Data Files (v1.0.0)

Interface between the generator (`backend/tools/generate_examples.py`, Python) and the frontend
(`frontend/src/lib/data/`, TypeScript). JSON shapes:
[example-data.schema.json](./example-data.schema.json). This document defines the binary layouts
and rules the schema cannot express. Both sides test against it: the generator validates its
output and the verifier decodes files independently; the frontend decodes committed fixtures.

## Directory layout (under `frontend/public/`)

```text
data/
├── examples/
│   ├── index.json                    # ExampleIndex — first entry is the default example
│   └── <example-id>/
│       ├── core.json                 # ExampleCore (RunCore + file index)
│       ├── embeddings-token.f32      # wte rows for the example's unique token IDs
│       ├── attention-L01.u16         # layer 1, all heads
│       ├── …
│       └── attention-L12.u16         # one file per layer (count = n_layer)
└── model/
    ├── wpe-0000-0063.f32             # position embedding rows 0..63
    └── wpe-0064-0127.f32             # rows 64..127 (covers live mode: 64 input + 64 steps)
```

Every `path` in a JSON file (`core` in `index.json`, `BinaryFile.path`) is relative to the JSON
file that contains it, resolved like a URL: `index.json` names `short-coffee/core.json` and
`../model/wpe-0000-0063.f32`; `core.json` names `attention-L01.u16` next to itself.

The model `config.json` is **not** a runtime fetch: it is copied to
`frontend/src/generated/gpt2-config.json` and bundled (≈ 1 KB).

## Binary encoding (all `.f32` / `.u16` files and API `EncodedArray`)

- Raw little-endian typed array, **no header**, row-major (C order), length =
  product(shape) × sizeof(dtype). Shape, dtype, scale and SHA-256 are in the JSON that references
  the file. Decoding: `new Float32Array(buf)` / `new Uint16Array(buf)` (all supported browsers
  are little-endian; the decoder asserts `byteLength` and fails closed otherwise).
- Real value = stored × `scale` (`scale` absent ⇒ 1).
- **float32**: exact copy of the model's float32 values.
- **uint16 attention**: stored = round(weight × 65535), `scale` = 1/65535; max error 7.6e-6.

### Attention packing

For a run of T tokens, each head's causal lower triangle is packed row by row:
`index(i, j) = i·(i+1)/2 + j` for 0 ≤ j ≤ i < T. File shape `[n_head, T·(T+1)/2]`. The data for
generation step k (prefix length t = n_input + k) is rows 0..t−1, i.e. the first t·(t+1)/2
entries of each head — no re-packing needed.

### Embeddings

- `embeddings-token.f32`: shape `[U, n_embd]`, `U = unique_ids.length`, row r = `wte[unique_ids[r]]`,
  `unique_ids` in order of first appearance in `run.tokens`.
- `wpe-*.f32`: shape `[64, n_embd]`, row r = `wpe[first_position + r]`.
- Sum vector = token row + position row, computed in float32 by the frontend.

## Rules

1. **Budget**: every file < 300,000 bytes raw (`bytes` field, checked by generator and by
   `check-budgets.mjs`). Initial load fetches only `index.json` and the default `core.json`;
   embeddings and attention files load when their view first opens.
2. **Integrity**: `sha256` of each binary is checked by the verifier and by a frontend unit test
   over the committed files; the browser checks `byteLength` against `shape`.
3. **Consistency**: `run.tokens.length = n_input + steps`; `predictions.length = steps + 1`;
   `layers.length = attention.length = n_layer`; change arrays and attention T equal
   `tokens.length`; `predictions[k-1].candidates[0].id = tokens[n_input + k − 1].id` for k ≥ 1.
4. **Number formatting in JSON**: probabilities and change percentages are written with
   7 significant digits.
5. **Tolerances** (verified by `verify_examples.py` against per-step HF reference runs):
   tokens identical; probabilities ≤ 1e-4 abs; attention ≤ 1e-3 abs; embeddings and change
   percentages ≤ 0.1 % relative.
6. **Provenance**: `model.revision` (40-hex commit SHA) and library `versions` are recorded; the
   frontend refuses live mode if the service's revision differs.
7. **Failure isolation**: a missing/corrupt file affects only its example and view; the frontend
   shows a translated error there and keeps everything else usable.
