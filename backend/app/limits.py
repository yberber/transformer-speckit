"""Shared product limits from `contracts/limits.json` (the same file the frontend imports).

Lookup order: env `LIMITS_PATH`, the repo checkout (`<repo>/contracts/limits.json`), then the
Docker image copy (`/app/contracts/limits.json`).
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import cache
from pathlib import Path

REPO_LIMITS = Path(__file__).resolve().parents[2] / "contracts" / "limits.json"
IMAGE_LIMITS = Path("/app/contracts/limits.json")


@dataclass(frozen=True)
class Limits:
    max_input_tokens: int
    max_new_tokens: int
    max_input_chars: int
    wait_limit_s: int
    example_steps: int
    file_budget_bytes: int
    initial_load_budget_bytes: int


def limits_path() -> Path:
    env = os.environ.get("LIMITS_PATH")
    if env:
        return Path(env)
    if REPO_LIMITS.is_file():
        return REPO_LIMITS
    return IMAGE_LIMITS


@cache
def load_limits() -> Limits:
    raw = json.loads(limits_path().read_text(encoding="utf-8"))
    return Limits(**{name: int(raw[name]) for name in Limits.__dataclass_fields__})
