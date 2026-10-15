"""Generate the example data, the bundled model config and the reference parameter shapes.

    uv run python -m tools.generate_examples          # regenerate and write
    uv run python -m tools.generate_examples --check  # fail if the committed files are stale

Uses the same computation core as the live service (`app.core.run`, research R4) and enforces the
example selection rules (R20). Every output is built in memory and checked (rules, per-file
budget, JSON Schema) before anything is written, so a failed run leaves the committed files as
they were. Output paths inside JSON are relative to the JSON file that references them.

`--check` regenerates in memory and compares with the committed files. Everything that does not
depend on floating-point kernels must be identical (file set, texts, tokens, IDs, shapes, model
config, embedding rows). Values computed by matrix multiplications may differ in the last bits
between CPUs, so they are compared with tolerances far below the verification tolerances
(FR-041): probabilities 1e-6 absolute, change percentages 1e-5 relative, attention ±1 uint16
step (1.5e-5). Library versions are compared without local build labels such as "+cpu".
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import tomllib
from pathlib import Path
from typing import Any

import numpy as np
import torch
from huggingface_hub import hf_hub_download
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from app.core import model as gpt2
from app.core.encode import pack_causal, quantize_u16, sha256_hex, to_le_bytes
from app.core.run import Run, compute_run, token_embeddings
from app.limits import Limits, load_limits

REPO = Path(__file__).resolve().parents[2]
EXAMPLES_TOML = Path(__file__).with_name("examples.toml")
SCHEMA_PATH = REPO / "contracts" / "example-data.schema.json"

EXAMPLES_DIR = Path("frontend/public/data/examples")
MODEL_DIR = Path("frontend/public/data/model")
TINY_DIR = Path("contracts/fixtures/data/tiny-example")
CONFIG_OUT = Path("frontend/src/generated/gpt2-config.json")
SHAPES_OUT = Path("frontend/tests/reference/param-shapes.json")
# Directories owned by the generator: cleared before writing, compared file by file in --check.
MANAGED_DIRS = [EXAMPLES_DIR, MODEL_DIR, TINY_DIR]

FORMAT_VERSION = "1.1.0"
ID_PATTERN = re.compile(r"^[a-z0-9-]{1,40}$")
BANDS = {"short": (5, 15), "medium": (20, 35), "long": (50, 64)}
PER_LENGTH = 2
MIN_MARGIN = 1e-3
WPE_SHARD_ROWS = 64
TINY_EXAMPLE = {"id": "tiny-example", "length": "short", "text": "Hello world"}
TINY_STEPS = 2

Outputs = dict[Path, bytes]


class RuleError(Exception):
    pass


def to_json(obj: Any, *, compact: bool = False) -> bytes:
    if compact:
        text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    else:
        text = json.dumps(obj, ensure_ascii=False, indent=2)
    return (text + "\n").encode("utf-8")


def binary_file(path: str, dtype: str, shape: list[int], data: bytes, scale: float | None = None):
    entry: dict[str, Any] = {"path": path, "dtype": dtype, "shape": shape}
    if scale is not None:
        entry["scale"] = scale
    entry["bytes"] = len(data)
    entry["sha256"] = sha256_hex(data)
    return entry


def model_ref() -> dict[str, Any]:
    return {"id": gpt2.MODEL_ID, "revision": gpt2.MODEL_REVISION, "versions": gpt2.versions()}


def load_examples() -> list[dict[str, str]]:
    with EXAMPLES_TOML.open("rb") as f:
        examples = tomllib.load(f)["example"]
    errors = []
    ids = [e["id"] for e in examples]
    if len(set(ids)) != len(ids):
        errors.append("example ids are not unique")
    for e in examples:
        if not ID_PATTERN.match(e["id"]):
            errors.append(f"{e['id']}: id does not match {ID_PATTERN.pattern}")
        if e["length"] not in BANDS:
            errors.append(f"{e['id']}: unknown length {e['length']!r}")
        if e["text"].rstrip().endswith("?"):
            errors.append(f"{e['id']}: text ends with '?' (examples are text to continue)")
    for length in BANDS:
        n = sum(e["length"] == length for e in examples)
        if n != PER_LENGTH:
            errors.append(f"expected {PER_LENGTH} {length} examples, found {n}")
    if errors:
        raise RuleError("\n".join(errors))
    return examples


def check_run(example: dict[str, str], run: Run, limits: Limits) -> list[str]:
    """Research R20 rules for one example's run."""
    errors = []
    lo, hi = BANDS[example["length"]]
    hi = min(hi, limits.max_input_tokens)
    if not lo <= run.n_input <= hi:
        errors.append(f"{example['id']}: {run.n_input} input tokens, outside {lo}–{hi}")
    if not (run.steps == limits.example_steps or run.stop_reason == "eos"):
        errors.append(
            f"{example['id']}: {run.steps} steps, stop {run.stop_reason} "
            f"(need {limits.example_steps} or eos)"
        )
    for k, pred in enumerate(run.predictions):
        margin = pred[0][1] - pred[1][1]
        if margin < MIN_MARGIN:
            errors.append(
                f"{example['id']}: step {k} top-1/top-2 margin {margin:.2e} < {MIN_MARGIN:g}"
            )
    return errors


def example_files(out: Outputs, rel_dir: Path, example: dict[str, str], run: Run) -> dict[str, Any]:
    """Binary files of one example plus its core.json. Returns the ExampleCore."""
    unique_ids, rows = token_embeddings(run.token_ids)
    data = to_le_bytes(rows, "float32")
    out[rel_dir / "embeddings-token.f32"] = data
    embeddings = binary_file("embeddings-token.f32", "float32", list(rows.shape), data)
    embeddings["unique_ids"] = unique_ids

    attention = []
    for layer, att in enumerate(run.attention, start=1):
        q, scale = quantize_u16(pack_causal(att))
        data = to_le_bytes(q, "uint16")
        name = f"attention-L{layer:02d}.u16"
        out[rel_dir / name] = data
        attention.append(binary_file(name, "uint16", list(q.shape), data, scale))

    core = {
        "format_version": FORMAT_VERSION,
        "example": {"id": example["id"], "length": example["length"], "text": example["text"]},
        "model": model_ref(),
        "run": run.to_core(),
        "files": {"embeddings_token": embeddings, "attention": attention},
    }
    out[rel_dir / "core.json"] = to_json(core, compact=True)
    return core


def position_shards(out: Outputs, limits: Limits) -> list[dict[str, Any]]:
    """Shared wpe rows 0 .. max_input_tokens + max_new_tokens − 1, 64 rows per file."""
    _, m = gpt2.load()
    rows = limits.max_input_tokens + limits.max_new_tokens
    wpe = m.transformer.wpe.weight.detach().to(torch.float32).numpy()[:rows]
    shards = []
    for first in range(0, rows, WPE_SHARD_ROWS):
        part = wpe[first : first + WPE_SHARD_ROWS]
        name = f"wpe-{first:04d}-{first + len(part) - 1:04d}.f32"
        data = to_le_bytes(part, "float32")
        out[MODEL_DIR / name] = data
        entry = binary_file(f"../model/{name}", "float32", list(part.shape), data)
        entry["first_position"] = first
        shards.append(entry)
    return shards


def param_shapes() -> dict[str, list[int]]:
    """{name: shape} of the real weights, `transformer.` prefix stripped, buffers excluded."""
    _, m = gpt2.load()
    buffers = {name for name, _ in m.named_buffers()}
    state = m.state_dict()
    shapes = {
        name.removeprefix("transformer."): list(t.shape)
        for name, t in state.items()
        if name not in buffers
    }
    shapes.setdefault("lm_head.weight", list(m.lm_head.weight.shape))
    return shapes


def schema_validators() -> dict[str, Draft202012Validator]:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    registry = Registry().with_resource(schema["$id"], Resource.from_contents(schema))
    return {
        name: Draft202012Validator({"$ref": f"{schema['$id']}#/$defs/{name}"}, registry=registry)
        for name in ("ExampleCore", "ExampleIndex")
    }


def generate(limits: Limits) -> Outputs:
    """Build every output in memory. Raises RuleError if any rule, budget or schema fails."""
    examples = load_examples()
    validators = schema_validators()
    out: Outputs = {}
    errors: list[str] = []
    docs: list[tuple[str, Path, Any]] = []
    n_input: dict[str, int] = {}

    for example in examples:
        print(f"  {example['id']} …", file=sys.stderr)
        run = compute_run(gpt2.tokenize(example["text"]), limits.example_steps)
        errors += check_run(example, run, limits)
        n_input[example["id"]] = run.n_input
        rel_dir = EXAMPLES_DIR / example["id"]
        docs.append(
            ("ExampleCore", rel_dir / "core.json", example_files(out, rel_dir, example, run))
        )

    index = {
        "format_version": FORMAT_VERSION,
        "model": model_ref(),
        "examples": [
            {
                "id": e["id"],
                "length": e["length"],
                "n_input": n_input[e["id"]],
                "core": f"{e['id']}/core.json",
            }
            for e in examples
        ],
        "position_embeddings": position_shards(out, limits),
    }
    out[EXAMPLES_DIR / "index.json"] = to_json(index)
    docs.append(("ExampleIndex", EXAMPLES_DIR / "index.json", index))

    # Decoder test fixture: same layout, no band rules.
    tiny_run = compute_run(gpt2.tokenize(TINY_EXAMPLE["text"]), TINY_STEPS)
    docs.append(
        (
            "ExampleCore",
            TINY_DIR / "core.json",
            example_files(out, TINY_DIR, TINY_EXAMPLE, tiny_run),
        )
    )

    config_path = hf_hub_download(gpt2.MODEL_ID, "config.json", revision=gpt2.MODEL_REVISION)
    out[CONFIG_OUT] = Path(config_path).read_bytes()  # verbatim copy
    out[SHAPES_OUT] = to_json(param_shapes())

    for name, path, doc in docs:
        for err in validators[name].iter_errors(doc):
            errors.append(f"{path}: schema: {err.message} at {list(err.absolute_path)}")
    for path, data in out.items():
        if len(data) >= limits.file_budget_bytes:
            errors.append(f"{path}: {len(data)} B ≥ budget {limits.file_budget_bytes} B")
    if errors:
        raise RuleError("\n".join(errors))
    return out


def write(out: Outputs) -> None:
    for d in MANAGED_DIRS:
        shutil.rmtree(REPO / d, ignore_errors=True)
    for path, data in sorted(out.items()):
        target = REPO / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


# --- --check ---------------------------------------------------------------------------------


def _strip_local(version: str) -> str:
    return version.split("+", 1)[0]


def _close(new: float, old: float, key: str) -> bool:
    if key == "prob":
        return abs(new - old) <= 1e-6
    return abs(new - old) <= 1e-5 * max(abs(old), 1e-12) + 1e-9


def _compare_json(new: Any, old: Any, where: str, key: str, diffs: list[str]) -> None:
    if key == "sha256":
        return  # binaries are compared directly; committed hashes are checked against disk
    if isinstance(new, dict) and isinstance(old, dict):
        if list(new) != list(old):
            diffs.append(f"{where}: keys {list(old)} → {list(new)}")
            return
        for k in new:
            if key == "versions":
                if _strip_local(new[k]) != _strip_local(old[k]):
                    diffs.append(f"{where}.{k}: {old[k]!r} → {new[k]!r}")
            else:
                _compare_json(new[k], old[k], f"{where}.{k}", k, diffs)
    elif isinstance(new, list) and isinstance(old, list):
        if len(new) != len(old):
            diffs.append(f"{where}: length {len(old)} → {len(new)}")
            return
        for i, (a, b) in enumerate(zip(new, old, strict=True)):
            _compare_json(a, b, f"{where}[{i}]", key, diffs)
    elif isinstance(new, float) or isinstance(old, float):
        if not (isinstance(new, int | float) and isinstance(old, int | float)):
            diffs.append(f"{where}: {old!r} → {new!r}")
        elif not _close(float(new), float(old), key):
            diffs.append(f"{where}: {old!r} → {new!r}")
    elif new != old or type(new) is not type(old):
        diffs.append(f"{where}: {old!r} → {new!r}")


def _committed_hashes(path: Path, doc: Any, diffs: list[str]) -> None:
    """Every sha256 in a committed JSON file must match the committed binary it names."""
    entries = []
    if "files" in doc:
        entries = [doc["files"]["embeddings_token"], *doc["files"]["attention"]]
    elif "position_embeddings" in doc:
        entries = doc["position_embeddings"]
    for entry in entries:
        target = (REPO / path).parent / entry["path"]
        if not target.is_file():
            diffs.append(f"{path}: {entry['path']} does not exist")
        elif sha256_hex(target.read_bytes()) != entry["sha256"]:
            diffs.append(f"{path}: sha256 of {entry['path']} does not match the file")


def compare(out: Outputs) -> list[str]:
    diffs: list[str] = []
    committed = {
        p.relative_to(REPO) for d in MANAGED_DIRS for p in (REPO / d).rglob("*") if p.is_file()
    }
    expected = {p for p in out if any(p.is_relative_to(d) for d in MANAGED_DIRS)}
    diffs += [f"{p}: missing" for p in sorted(expected - committed)]
    diffs += [f"{p}: not produced by the generator" for p in sorted(committed - expected)]

    for path, data in sorted(out.items()):
        disk = REPO / path
        if not disk.is_file():
            if path not in expected:
                diffs.append(f"{path}: missing")
            continue
        old = disk.read_bytes()
        if path.suffix == ".json" and path not in (CONFIG_OUT, SHAPES_OUT):
            old_doc = json.loads(old)
            _compare_json(json.loads(data), old_doc, str(path), "", diffs)
            _committed_hashes(path, old_doc, diffs)
        elif path.suffix == ".u16":
            a = np.frombuffer(data, dtype="<u2").astype(np.int32)
            b = np.frombuffer(old, dtype="<u2").astype(np.int32)
            if a.shape != b.shape:
                diffs.append(f"{path}: {len(old)} B → {len(data)} B")
            elif np.abs(a - b).max(initial=0) > 1:
                diffs.append(f"{path}: attention differs by more than one uint16 step")
        elif data != old:
            diffs.append(f"{path}: content differs")
    return diffs


def main() -> int:
    parser = argparse.ArgumentParser(prog="python -m tools.generate_examples")
    parser.add_argument(
        "--check", action="store_true", help="regenerate in memory and compare with the repo"
    )
    args = parser.parse_args()
    limits = load_limits()
    print(f"model {gpt2.MODEL_ID}@{gpt2.MODEL_REVISION}", file=sys.stderr)
    try:
        out = generate(limits)
    except RuleError as e:
        print(f"FAILED: example data rules\n{e}", file=sys.stderr)
        return 1
    if args.check:
        diffs = compare(out)
        if diffs:
            print("FAILED: committed files differ from a fresh generation:", file=sys.stderr)
            print("\n".join(f"  {d}" for d in diffs[:50]), file=sys.stderr)
            if len(diffs) > 50:
                print(f"  … {len(diffs) - 50} more", file=sys.stderr)
            return 1
        print(f"OK: {len(out)} files match")
        return 0
    write(out)
    for path, data in sorted(out.items()):
        print(f"{len(data):>9} B  {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
