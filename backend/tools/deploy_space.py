"""Deploy the inference service to a Hugging Face Docker Space.

    HF_TOKEN=... uv run python -m tools.deploy_space --space <user>/<space>
    uv run python -m tools.deploy_space --space <user>/<space> --dry-run

The Space repository gets what the Docker build needs and nothing else: `backend/` without the
virtualenv, tests, tools and caches, plus the repo-root `contracts/` (the Dockerfile copies
`contracts/` into the image). They are staged in a temporary directory and uploaded in one
commit; files from earlier deploys that are no longer staged are removed. `backend/README.md`
becomes the Space card (`sdk: docker`, `app_port: 7860`). Set `ALLOWED_ORIGINS` in the Space
settings. `--dry-run` stages and lists the files without uploading and needs no token.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
CONTRACTS = BACKEND.parent / "contracts"

# Top-level entries of backend/ that never go to the Space. `contracts` is a leftover of a local
# `docker build` (README); the repo-root contracts/ is staged instead.
SKIP_TOP = {".venv", "venv", "tests", "tools", "contracts"}
# Skipped at any depth.
SKIP_ANY = {
    "__pycache__",
    ".pytest_cache",
    ".ruff_cache",
    ".mypy_cache",
    ".cache",
    ".DS_Store",
    ".env",
}


def _skip(name: str) -> bool:
    return name in SKIP_ANY or name.startswith(".env.") or name.endswith((".pyc", ".pyo"))


def stage(dest: Path) -> list[str]:
    """Copy the Space's files into `dest`; return their paths relative to it, sorted."""
    for entry in sorted(BACKEND.iterdir()):
        if entry.name in SKIP_TOP or _skip(entry.name):
            continue
        target = dest / entry.name
        if entry.is_dir():
            shutil.copytree(entry, target, ignore=lambda _d, names: [n for n in names if _skip(n)])
        else:
            shutil.copy2(entry, target)
    shutil.copytree(
        CONTRACTS, dest / "contracts", ignore=lambda _d, names: [n for n in names if _skip(n)]
    )
    return sorted(p.relative_to(dest).as_posix() for p in dest.rglob("*") if p.is_file())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--space", required=True, help="the Space repository, <user>/<space>")
    parser.add_argument(
        "--dry-run", action="store_true", help="stage and list the files, upload nothing"
    )
    args = parser.parse_args(argv)
    if args.space.count("/") != 1 or not all(args.space.split("/")):
        parser.error("--space must look like <user>/<space>")

    token = os.environ.get("HF_TOKEN", "")
    if not token and not args.dry_run:
        print("HF_TOKEN is not set: create a write token at huggingface.co/settings/tokens")
        return 2

    with tempfile.TemporaryDirectory(prefix="space-") as tmp:
        staging = Path(tmp)
        files = stage(staging)
        for f in files:
            print(f)
        print(f"{len(files)} files staged for {args.space}")
        if args.dry_run:
            return 0

        from huggingface_hub import HfApi

        commit = HfApi(token=token).upload_folder(
            repo_id=args.space,
            repo_type="space",
            folder_path=staging,
            commit_message="Deploy the inference service",
            delete_patterns="*",
        )
        print(f"uploaded: {commit.commit_url}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
