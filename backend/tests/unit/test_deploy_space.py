"""tools/deploy_space.py stages exactly what the Space's Docker build needs (T137)."""

from __future__ import annotations

from pathlib import Path

import pytest

from tools import deploy_space


def test_stage_has_the_docker_build_inputs_and_nothing_else(tmp_path: Path) -> None:
    files = deploy_space.stage(tmp_path)

    for needed in [
        "Dockerfile",
        ".dockerignore",
        "README.md",
        "pyproject.toml",
        "uv.lock",
        "app/main.py",
        "app/core/model.py",
        "contracts/limits.json",
        "contracts/inference-api.openapi.yaml",
        "contracts/example-data.schema.json",
    ]:
        assert needed in files

    for f in files:
        parts = f.split("/")
        assert parts[0] not in {".venv", "venv", "tests", "tools"}, f
        assert not {"__pycache__", ".pytest_cache", ".ruff_cache", ".cache"} & set(parts), f
        assert not f.endswith((".pyc", ".pyo")), f
        assert not parts[-1].startswith(".env"), f


def test_space_card_is_the_backend_readme(tmp_path: Path) -> None:
    deploy_space.stage(tmp_path)
    card = (tmp_path / "README.md").read_text(encoding="utf-8")
    assert "sdk: docker" in card
    assert "app_port: 7860" in card


def test_no_token_means_no_upload(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("HF_TOKEN", raising=False)
    assert deploy_space.main(["--space", "user/space"]) == 2


def test_dry_run_needs_no_token(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv("HF_TOKEN", raising=False)
    assert deploy_space.main(["--space", "user/space", "--dry-run"]) == 0
    assert "files staged for user/space" in capsys.readouterr().out


@pytest.mark.parametrize("space", ["space", "user/", "/space", "a/b/c"])
def test_space_must_be_user_slash_name(space: str) -> None:
    with pytest.raises(SystemExit):
        deploy_space.main(["--space", space, "--dry-run"])
