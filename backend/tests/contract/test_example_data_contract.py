"""Committed example data against the authoritative contract (Principle IX).

`index.json` and every `core.json` validate with Draft 2020-12 against
`contracts/example-data.schema.json`, and each index entry's `n_input` equals the `run.n_input` of
the `core.json` it names (contracts/example-data.md rule 3). The picker relies on it to show every
token count from `index.json` alone (rule 1). No model is needed.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

REPO = Path(__file__).resolve().parents[3]
EXAMPLES = REPO / "frontend" / "public" / "data" / "examples"
SCHEMA = json.loads((REPO / "contracts" / "example-data.schema.json").read_text(encoding="utf-8"))
REGISTRY = Registry().with_resource(SCHEMA["$id"], Resource.from_contents(SCHEMA))
INDEX = json.loads((EXAMPLES / "index.json").read_text(encoding="utf-8"))


def validate(doc: Any, name: str) -> None:
    schema = {"$ref": f"{SCHEMA['$id']}#/$defs/{name}"}
    Draft202012Validator(schema, registry=REGISTRY).validate(doc)


def test_index_is_valid() -> None:
    validate(INDEX, "ExampleIndex")


@pytest.mark.parametrize("entry", INDEX["examples"], ids=lambda e: e["id"])
def test_core_is_valid_and_matches_its_index_entry(entry: dict[str, Any]) -> None:
    core = json.loads((EXAMPLES / entry["core"]).read_text(encoding="utf-8"))
    validate(core, "ExampleCore")
    assert core["example"]["id"] == entry["id"]
    assert core["example"]["length"] == entry["length"]
    assert core["run"]["n_input"] == entry["n_input"]
