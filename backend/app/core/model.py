"""Pinned GPT-2 small: loading, tokenization and token bytes.

The model revision is pinned here and nowhere else (never "main"); the generator records it in
the example data and the service reports it in /health, so the frontend can refuse a service
whose model differs from the shipped examples.

`python -m app.core.model --download` fetches the pinned snapshot (used by the Docker build so a
cold start never downloads the model).
"""

from __future__ import annotations

import argparse
import os
from functools import cache

import torch
import transformers
from transformers import GPT2LMHeadModel, GPT2TokenizerFast

MODEL_ID = "openai-community/gpt2"
# Commit SHA of MODEL_ID on the Hugging Face Hub, resolved 2026-10-14 with
# `huggingface_hub.HfApi().model_info(MODEL_ID).sha`.
MODEL_REVISION = "607a30d783dfa663caf39e06633721c8d4cfcd7e"

# Files needed to run the model (the repo also ships ONNX, TF, Flax and Rust weights).
SNAPSHOT_FILES = [
    "config.json",
    "generation_config.json",
    "merges.txt",
    "model.safetensors",
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.json",
]


@cache
def load() -> tuple[GPT2TokenizerFast, GPT2LMHeadModel]:
    """Load the pinned tokenizer and model once per process (float32, eager attention, eval)."""
    torch.set_num_threads(int(os.environ.get("TORCH_THREADS", "2")))
    tokenizer = GPT2TokenizerFast.from_pretrained(MODEL_ID, revision=MODEL_REVISION)
    model = GPT2LMHeadModel.from_pretrained(
        MODEL_ID,
        revision=MODEL_REVISION,
        # Eager attention is the only implementation that returns attention weights.
        attn_implementation="eager",
        dtype=torch.float32,
    )
    model.eval()
    return tokenizer, model


def tokenize(text: str) -> list[int]:
    """Token IDs for `text`. Literal special-token text such as "<|endoftext|>" is ordinary text
    (research R8), so live mode and example mode tokenize it the same way."""
    tokenizer, _ = load()
    return list(tokenizer(text, split_special_tokens=True)["input_ids"])


@cache
def _byte_decoder() -> dict[str, int]:
    """Inverse of GPT-2's byte-level BPE alphabet: each byte 0..255 is drawn as one printable
    unicode character in the vocabulary (e.g. space → "Ġ", newline → "Ċ")."""
    printable = (
        list(range(ord("!"), ord("~") + 1))
        + list(range(ord("¡"), ord("¬") + 1))
        + list(range(ord("®"), ord("ÿ") + 1))
    )
    chars = printable[:]
    n = 0
    for b in range(256):
        if b not in printable:
            printable.append(b)
            chars.append(256 + n)
            n += 1
    return {chr(c): b for b, c in zip(printable, chars, strict=True)}


def token_bytes(token_id: int) -> bytes:
    """Raw bytes of one token. May be part of a UTF-8 character (research R9)."""
    tokenizer, _ = load()
    piece = tokenizer.convert_ids_to_tokens(token_id)
    if token_id == tokenizer.eos_token_id:
        # The only added special token; it is not drawn in the byte alphabet.
        return piece.encode("utf-8")
    decoder = _byte_decoder()
    return bytes(decoder[ch] for ch in piece)


def eos_token_id() -> int:
    tokenizer, _ = load()
    return int(tokenizer.eos_token_id)


def versions() -> dict[str, str]:
    return {"torch": torch.__version__, "transformers": transformers.__version__}


def download() -> str:
    """Download the pinned snapshot into the Hugging Face cache and return its path."""
    from huggingface_hub import snapshot_download

    return snapshot_download(MODEL_ID, revision=MODEL_REVISION, allow_patterns=SNAPSHOT_FILES)


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.core.model")
    parser.add_argument(
        "--download", action="store_true", help="download the pinned model snapshot"
    )
    args = parser.parse_args()
    if args.download:
        print(download())
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
