# GPT-2 small: hand-computed reference values

Reference values for the parameter, FLOP and KV-cache calculations (Principle II, FR-042,
SC-003). Each value is derived by hand below from the official `config.json` of
`openai-community/gpt2` and from the formulas in research R10. The tests read the JSON block at
the end of this file and compare it with `src/lib/model/{params,flops,kvcache}.ts`.

This directory is the only place outside generated files where these numbers may be written
(Principle I).

## Inputs from the official config

| Symbol | Config key | Value |
|---|---|---|
| d | `n_embd` | 768 |
| L | `n_layer` | 12 |
| H | `n_head` | 12 |
| f | `n_inner` (null ⇒ 4·d) | 4 × 768 = 3,072 |
| V | `vocab_size` | 50,257 |
| P | `n_positions` | 1,024 |

## Counting conventions (research R10)

- Forward pass only. One multiply-add = 2 FLOPs. Only matrix multiplications are counted; bias
  adds, layer norm, softmax, GELU and residual adds are left out. The embedding lookup costs 0.
- Adding the position embedding is a separate item: d additions per token.
- Causal attention counts only unmasked (query, key) pairs.
- The LM head runs only for the position whose next token is predicted.
- HF GPT-2 stores linear weights as `Conv1D`, shape (in, out).

## Parameters

| Group | Shape(s) | Derivation | Count |
|---|---|---|---|
| `wte.weight` | (V, d) | 50,257 × 768 | 38,597,376 |
| `wpe.weight` | (P, d) | 1,024 × 768 | 786,432 |
| `h.l.ln_1` | weight (d), bias (d) | 768 + 768 | 1,536 |
| `h.l.attn.c_attn` | weight (d, 3d), bias (3d) | 768 × 2,304 + 2,304 = 1,769,472 + 2,304 | 1,771,776 |
| `h.l.attn.c_proj` | weight (d, d), bias (d) | 768 × 768 + 768 = 589,824 + 768 | 590,592 |
| `h.l.ln_2` | weight (d), bias (d) | 768 + 768 | 1,536 |
| `h.l.mlp.c_fc` | weight (d, f), bias (f) | 768 × 3,072 + 3,072 = 2,359,296 + 3,072 | 2,362,368 |
| `h.l.mlp.c_proj` | weight (f, d), bias (d) | 3,072 × 768 + 768 = 2,359,296 + 768 | 2,360,064 |
| one block | | 1,536 + 1,771,776 + 590,592 + 1,536 + 2,362,368 + 2,360,064 | 7,087,872 |
| all blocks | | 12 × 7,087,872 | 85,054,464 |
| `ln_f` | weight (d), bias (d) | 768 + 768 | 1,536 |
| `lm_head.weight` | (V, d), tied to `wte.weight` | counted once, in `wte` | 0 extra |
| **total** | | 38,597,376 + 786,432 + 85,054,464 + 1,536 | **124,439,808** |

## FLOPs per layer for one new token (decode at context length t)

| Component | Formula | Derivation | FLOPs |
|---|---|---|---|
| QKV projection | 6d² | 6 × 768² = 6 × 589,824 | 3,538,944 |
| Attention scores (Q·Kᵀ) | 2d·t | one query against t keys, d multiply-adds each (over all heads) | 1,536·t |
| Attention weighting (A·V) | 2d·t | t weights times d-wide values | 1,536·t |
| Output projection | 2d² | 2 × 589,824 | 1,179,648 |
| MLP (up + down) | 4d·f | 2 × (768 × 3,072) multiply-adds × 2 = 4 × 2,359,296 | 9,437,184 |
| Matmuls without attention | 6d² + 2d² + 4df | 3,538,944 + 1,179,648 + 9,437,184 | 14,155,776 |
| … in all 12 layers | ×L | 12 × 14,155,776 | 169,869,312 |

Non-layer items per new token:

| Component | Formula | Derivation | FLOPs |
|---|---|---|---|
| Position add | d | one addition per dimension | 768 |
| LM head | 2d·V | 2 × 768 × 50,257 | 77,194,752 |

## Decode totals

decode(t) = L·(6d² + 2d² + 4df + 4d·t) + d + 2d·V
= 169,869,312 + 12 × 3,072·t + 768 + 77,194,752
= 247,064,832 + 36,864·t

| t | Derivation | FLOPs |
|---|---|---|
| 1 | 247,064,832 + 36,864 | 247,101,696 |
| 10 | 247,064,832 + 368,640 | 247,433,472 |
| 1,024 | 247,064,832 + 37,748,736 | 284,813,568 |

## Prefill totals

prefill(n) = L·((6d² + 2d² + 4df)·n + 2d·n(n+1)) + d·n + 2d·V. Attention covers the causal
triangle: query i (1-based) sees i keys, Σᵢ i = n(n+1)/2 pairs, d multiply-adds each for the
scores and again for the weighting: 2 × 2 × d × n(n+1)/2 = 2d·n(n+1). The LM head runs once.

| n | Derivation | FLOPs |
|---|---|---|
| 10 | 12 × (14,155,776 × 10 + 1,536 × 110) + 7,680 + 77,194,752 = 12 × 141,726,720 + 77,202,432 | 1,777,923,072 |
| 64 | 12 × (14,155,776 × 64 + 1,536 × 4,160) + 49,152 + 77,194,752 = 12 × 912,359,424 + 77,243,904 | 11,025,556,992 |

## KV cache (float32)

bytes(t) = 2 (K and V) · L · t · d · 4 bytes.

| t | Derivation | Bytes |
|---|---|---|
| per token | 2 × 12 × 768 × 4 | 73,728 |
| 1,024 | 73,728 × 1,024 | 75,497,472 |

## Machine-readable values

```json
{
  "config": {
    "n_embd": 768,
    "n_layer": 12,
    "n_head": 12,
    "n_inner": 3072,
    "vocab_size": 50257,
    "n_positions": 1024
  },
  "params": {
    "wte": 38597376,
    "wpe": 786432,
    "block": {
      "ln_1": 1536,
      "attn.c_attn": 1771776,
      "attn.c_proj": 590592,
      "ln_2": 1536,
      "mlp.c_fc": 2362368,
      "mlp.c_proj": 2360064
    },
    "per_block": 7087872,
    "all_blocks": 85054464,
    "ln_f": 1536,
    "total": 124439808
  },
  "decode_per_layer": {
    "qkv": 3538944,
    "attn_scores_per_t": 1536,
    "attn_weighting_per_t": 1536,
    "attn_out": 1179648,
    "mlp": 9437184,
    "matmuls_without_attention": 14155776
  },
  "all_layers_matmuls_without_attention": 169869312,
  "pos_add": 768,
  "lm_head": 77194752,
  "decode": { "1": 247101696, "10": 247433472, "1024": 284813568 },
  "prefill": { "10": 1777923072, "64": 11025556992 },
  "kv_cache_bytes": { "per_token": 73728, "1024": 75497472 }
}
```
