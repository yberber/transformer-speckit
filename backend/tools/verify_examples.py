"""Verify the shipped example data against reference GPT-2 runs (FR-041, SC-001).

    uv run python -m tools.verify_examples              # verify every example, every step
    uv run python -m tools.verify_examples --self-test  # prove that breaches are detected

An independent code path from the generator: it does not import `app.core.run` or
`app.core.encode`. It loads the pinned model with transformers itself, runs one full forward pass
per step on the prefix of length n_input + k (no KV cache), decodes the shipped JSON and binary
files with its own numpy code, and checks every SHA-256. Change percentages come from its own
hooks at different points than the generator's: block input x, ln_2 input y = x + a, and MLP
output m, so a = y − x.

Tolerances (example-data.md rule 5):
- tokens and top-10 candidate IDs identical (candidate order may differ only between candidates
  whose reference probabilities are within NOISE of each other: float rounding, not a model
  difference)
- probabilities ≤ 1e-4 absolute
- attention weights ≤ 1e-3 absolute
- token/position embeddings and change percentages ≤ 0.1 % relative
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from transformers import GPT2LMHeadModel, GPT2TokenizerFast

from app.core.model import MODEL_ID, MODEL_REVISION

REPO = Path(__file__).resolve().parents[2]
INDEX = REPO / "frontend" / "public" / "data" / "examples" / "index.json"

PROB_ABS = 1e-4
ATTENTION_ABS = 1e-3
VECTOR_REL = 1e-3
NOISE = 1e-6
MAX_REPORTED = 20

_NP_DTYPES = {"float32": "<f4", "uint16": "<u2"}


class FileError(Exception):
    pass


@dataclass
class Shipped:
    """One example as shipped, decoded independently of the generator."""

    example_id: str
    text: str
    run: dict
    unique_ids: list[int]
    token_rows: np.ndarray  # [U, d]
    attention: list[np.ndarray]  # per layer, [H, T(T+1)/2] dequantized


def read_binary(base: Path, entry: dict) -> np.ndarray:
    path = base / entry["path"]
    raw = path.read_bytes()
    if len(raw) != entry["bytes"]:
        raise FileError(f"{path}: {len(raw)} B, core says {entry['bytes']} B")
    if hashlib.sha256(raw).hexdigest() != entry["sha256"]:
        raise FileError(f"{path}: sha256 mismatch")
    shape = tuple(entry["shape"])
    arr = np.frombuffer(raw, dtype=_NP_DTYPES[entry["dtype"]])
    if arr.size != int(np.prod(shape)):
        raise FileError(f"{path}: {arr.size} values, shape {shape}")
    return arr.reshape(shape).astype(np.float64) * entry.get("scale", 1)


def load_shipped(core_path: Path) -> Shipped:
    core = json.loads(core_path.read_text(encoding="utf-8"))
    if core["model"]["revision"] != MODEL_REVISION:
        raise FileError(f"{core_path}: model revision {core['model']['revision']}")
    base = core_path.parent
    emb = core["files"]["embeddings_token"]
    return Shipped(
        example_id=core["example"]["id"],
        text=core["example"]["text"],
        run=core["run"],
        unique_ids=list(emb["unique_ids"]),
        token_rows=read_binary(base, emb),
        attention=[read_binary(base, f) for f in core["files"]["attention"]],
    )


def load_positions(index: dict) -> np.ndarray:
    shards = sorted(index["position_embeddings"], key=lambda s: s["first_position"])
    rows = []
    for shard in shards:
        if shard["first_position"] != sum(len(r) for r in rows):
            raise FileError(f"{shard['path']}: gap before position {shard['first_position']}")
        rows.append(read_binary(INDEX.parent, shard))
    return np.concatenate(rows)


def triangle_row(packed_head: np.ndarray, i: int) -> np.ndarray:
    start = i * (i + 1) // 2
    return packed_head[start : start + i + 1]


class Reference:
    def __init__(self) -> None:
        self.tokenizer = GPT2TokenizerFast.from_pretrained(MODEL_ID, revision=MODEL_REVISION)
        self.model = GPT2LMHeadModel.from_pretrained(
            MODEL_ID, revision=MODEL_REVISION, attn_implementation="eager", dtype=torch.float32
        ).eval()
        self.byte_of = self._byte_table()

    @staticmethod
    def _byte_table() -> dict[str, int]:
        # GPT-2's byte-level alphabet: printable bytes map to themselves, the other 68 bytes to
        # code points 256, 257, … in byte order.
        keep = [*range(33, 127), *range(161, 173), *range(174, 256)]
        table = {chr(b): b for b in keep}
        extra = (b for b in range(256) if b not in keep)
        table.update({chr(256 + n): b for n, b in enumerate(extra)})
        return table

    def token_bytes(self, token_id: int) -> list[int]:
        if token_id == self.tokenizer.eos_token_id:
            return list(self.tokenizer.eos_token.encode())
        return [self.byte_of[c] for c in self.tokenizer.convert_ids_to_tokens(token_id)]

    @torch.inference_mode()
    def prefix(self, ids: list[int]):
        """Probabilities of the next token, attention [L,H,t,t] and change % [L,t] (float64)."""
        xs, ys, ms = [], [], []
        hooks = []
        for block in self.model.transformer.h:
            hooks.append(block.register_forward_pre_hook(lambda _m, a: xs.append(a[0][0])))
            hooks.append(block.ln_2.register_forward_pre_hook(lambda _m, a: ys.append(a[0][0])))
            hooks.append(block.mlp.register_forward_hook(lambda _m, _a, o: ms.append(o[0])))
        try:
            out = self.model(torch.tensor([ids]), output_attentions=True, use_cache=False)
        finally:
            for h in hooks:
                h.remove()
        probs = torch.softmax(out.logits[0, -1].float(), dim=-1).double().numpy()
        att = torch.stack([a[0] for a in out.attentions]).double().numpy()
        x, y, m = (torch.stack(v).double() for v in (xs, ys, ms))
        attn_pct = ((y - x).norm(dim=-1) / x.norm(dim=-1) * 100).numpy()
        mlp_pct = (m.norm(dim=-1) / y.norm(dim=-1) * 100).numpy()
        return probs, att, attn_pct, mlp_pct


def rel_breach(shipped: np.ndarray, ref: np.ndarray) -> np.ndarray:
    return np.abs(shipped - ref) > VECTOR_REL * np.abs(ref) + 1e-12


def verify_example(ref: Reference, ex: Shipped, positions: np.ndarray) -> list[str]:
    """Breaches for one example; prints one line per step. Each breach starts with its kind."""
    breaches: list[str] = []
    run = ex.run
    n, steps = run["n_input"], run["steps"]
    ids = [t["id"] for t in run["tokens"]]
    cfg = ref.model.config
    tag = ex.example_id

    # Structure (example-data.md rule 3).
    if len(ids) != n + steps or len(run["predictions"]) != steps + 1:
        breaches.append(f"structure {tag}: token/prediction counts do not match n_input/steps")
    if len(run["layers"]) != cfg.n_layer or len(ex.attention) != cfg.n_layer:
        breaches.append(f"structure {tag}: layer count differs from n_layer")
    if breaches:
        return breaches

    # Tokens: the reference tokenization of the text, and the bytes of every token.
    expected = ref.tokenizer(ex.text, split_special_tokens=True)["input_ids"]
    if ids[:n] != list(expected):
        breaches.append(f"token {tag}: input tokens differ from the reference tokenization")
    for pos, tok in enumerate(run["tokens"]):
        if tok["bytes"] != ref.token_bytes(tok["id"]):
            breaches.append(f"token {tag}: bytes of token {pos} (id {tok['id']}) differ")

    # Embeddings: token rows for unique ids (first appearance), position rows.
    seen: list[int] = []
    for i in ids:
        if i not in seen:
            seen.append(i)
    if ex.unique_ids != seen:
        breaches.append(f"embedding {tag}: unique_ids are not the tokens' first appearances")
    else:
        wte = ref.model.transformer.wte.weight.detach().double().numpy()
        bad = rel_breach(ex.token_rows, wte[ex.unique_ids])
        if bad.any():
            r, c = np.argwhere(bad)[0]
            breaches.append(f"embedding {tag}: token row {r} dim {c} beyond 0.1 %")
    wpe = ref.model.transformer.wpe.weight.detach().double().numpy()
    if positions.shape[0] < n + steps:
        breaches.append(f"embedding {tag}: position shards cover only {positions.shape[0]} rows")
    else:
        bad = rel_breach(positions, wpe[: positions.shape[0]])
        if bad.any():
            r, c = np.argwhere(bad)[0]
            breaches.append(f"embedding position row {r} dim {c} beyond 0.1 %")

    # Every step k: reference run on the prefix of length n + k.
    for k in range(steps + 1):
        t = n + k
        probs, att, attn_pct, mlp_pct = ref.prefix(ids[:t])
        step_breaches: list[str] = []
        where = f"{tag} step {k}"

        cands = run["predictions"][k]["candidates"]
        cand_ids = [c["id"] for c in cands]
        ranked = sorted(range(len(probs)), key=lambda i: (-probs[i], i))
        if cand_ids[0] != ranked[0]:
            step_breaches.append(f"token {where}: greedy id {cand_ids[0]} ≠ reference {ranked[0]}")
        if k < steps and ids[t] != ranked[0]:
            step_breaches.append(f"token {where}: appended id {ids[t]} ≠ reference {ranked[0]}")
        outside = max(probs[i] for i in ranked[:11] if i not in cand_ids)
        if set(cand_ids) != set(ranked[:10]) and min(probs[cand_ids]) < outside - NOISE:
            step_breaches.append(f"token {where}: top-10 ids differ from the reference")
        for a, b in zip(cand_ids, cand_ids[1:], strict=False):
            if probs[a] < probs[b] - NOISE or (abs(probs[a] - probs[b]) <= 0 and a > b):
                step_breaches.append(f"token {where}: candidates {a}, {b} out of order")
        max_dp = 0.0
        for c in cands:
            if c["bytes"] != ref.token_bytes(c["id"]):
                step_breaches.append(f"token {where}: bytes of candidate {c['id']} differ")
            dp = abs(c["prob"] - probs[c["id"]])
            max_dp = max(max_dp, dp)
            if dp > PROB_ABS:
                step_breaches.append(f"prob {where}: id {c['id']} off by {dp:.2e}")

        max_da = 0.0
        for layer in range(cfg.n_layer):
            for i in range(t):
                rows = np.stack([triangle_row(h, i) for h in ex.attention[layer]])
                da = np.abs(rows - att[layer, :, i, : i + 1]).max()
                max_da = max(max_da, da)
                if da > ATTENTION_ABS:
                    step_breaches.append(
                        f"attention {where}: layer {layer + 1} row {i} off by {da:.2e}"
                    )
        if np.abs(att[:, :, np.triu_indices(t, 1)[0], np.triu_indices(t, 1)[1]]).max(initial=0):
            step_breaches.append(f"attention {where}: reference has weight on future tokens")

        max_dc = 0.0
        for layer, change in enumerate(run["layers"]):
            for name, ref_pct in (("attn", attn_pct[layer]), ("mlp", mlp_pct[layer])):
                shipped = np.array(change[f"{name}_change_pct"][:t])
                rel = np.abs(shipped - ref_pct) / np.abs(ref_pct)
                max_dc = max(max_dc, float(rel.max()))
                if rel_breach(shipped, ref_pct).any():
                    step_breaches.append(
                        f"change {where}: layer {layer + 1} {name} beyond 0.1 % "
                        f"(max {rel.max():.2e})"
                    )

        status = "ok" if not step_breaches else "FAIL"
        print(
            f"{tag:>18} step {k:2d}  t={t:3d}  max |Δprob| {max_dp:.1e}  "
            f"max |Δattn| {max_da:.1e}  max rel Δchange {max_dc:.1e}  {status}"
        )
        breaches += step_breaches
    return breaches


def verify_all(ref: Reference) -> int:
    index = json.loads(INDEX.read_text(encoding="utf-8"))
    if index["model"]["revision"] != MODEL_REVISION:
        print(f"FAIL: index.json model revision {index['model']['revision']}")
        return 1
    breaches: list[str] = []
    try:
        positions = load_positions(index)
        examples = [load_shipped(INDEX.parent / e["core"]) for e in index["examples"]]
    except FileError as e:
        print(f"FAIL: {e}")
        return 1
    for ex in examples:
        breaches += verify_example(ref, ex, positions)
    if breaches:
        print(f"FAIL: {len(breaches)} breaches; first {min(len(breaches), MAX_REPORTED)}:")
        for b in breaches[:MAX_REPORTED]:
            print(f"  {b}")
        return 1
    print("PASS")
    return 0


def self_test(ref: Reference) -> int:
    """Corrupt in-memory copies of the default example and check each corruption is caught."""
    index = json.loads(INDEX.read_text(encoding="utf-8"))
    positions = load_positions(index)
    clean = load_shipped(INDEX.parent / index["examples"][0]["core"])
    if verify_example(ref, clean, positions):
        print("FAIL: the clean default example does not verify")
        return 1

    prob = copy.deepcopy(clean)
    prob.run["predictions"][1]["candidates"][3]["prob"] += 2e-4

    attention = copy.deepcopy(clean)
    attention.attention[4] = attention.attention[4].copy()
    attention.attention[4][2, 7] += 2e-3

    embedding = copy.deepcopy(clean)
    embedding.token_rows = embedding.token_rows.copy()
    r, c = np.unravel_index(np.abs(embedding.token_rows).argmax(), embedding.token_rows.shape)
    embedding.token_rows[r, c] *= 1.002

    failed = False
    for kind, ex in (("prob", prob), ("attention", attention), ("embedding", embedding)):
        print(f"-- corrupted {kind}")
        found = [b for b in verify_example(ref, ex, positions) if b.startswith(kind)]
        print(f"{'detected' if found else 'NOT DETECTED'}: {kind} corruption")
        failed |= not found
    if failed:
        print("FAIL")
        return 1
    print("PASS: every corruption was detected")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="python -m tools.verify_examples")
    parser.add_argument(
        "--self-test", action="store_true", help="check that tolerance breaches are detected"
    )
    args = parser.parse_args()
    ref = Reference()
    return self_test(ref) if args.self_test else verify_all(ref)


if __name__ == "__main__":
    sys.exit(main())
