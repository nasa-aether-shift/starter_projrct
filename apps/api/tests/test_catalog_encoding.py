"""Catalog text must load as UTF-8 on every OS (Windows defaults to cp1252, which garbles the Twi names)."""
import ast
from pathlib import Path

import yaml

import app.main as m

ROOT = Path(__file__).resolve().parents[3]
CATALOG_FILES = sorted((ROOT / "data" / "catalog").glob("*.yaml"))
MOJIBAKE = ("Ã", "Â", "É›", "É”", "�")  # what UTF-8 Twi letters (ɛ, ɔ) look like when read as cp1252


def _strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)


def test_catalog_contains_non_ascii_text():
    # Guards the test below: it only proves something while a catalog file holds non-ASCII (Twi) text.
    assert any(not path.read_bytes().isascii() for path in CATALOG_FILES)


def test_api_loads_every_catalog_file_as_utf8():
    assert set(m.CATALOG) == {path.stem for path in CATALOG_FILES}
    for path in CATALOG_FILES:
        assert m.CATALOG[path.stem] == yaml.safe_load(path.read_bytes().decode("utf-8")), path.name
        for text in _strings(m.CATALOG[path.stem]):
            assert not any(marker in text for marker in MOJIBAKE), (path.name, text)


def test_api_code_names_an_encoding_for_text_files():
    # The catalog test above only fails on Windows; this one also catches a missing encoding on Linux CI.
    missing = []
    for source in sorted((ROOT / "apps" / "api" / "app").glob("*.py")):
        for node in ast.walk(ast.parse(source.read_text(encoding="utf-8"))):
            if not isinstance(node, ast.Call):
                continue
            name = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, "id", "")
            if name not in {"read_text", "write_text", "open"}:
                continue
            modes = [a.value for a in node.args if isinstance(a, ast.Constant) and isinstance(a.value, str)]
            if any("b" in mode for mode in modes) or any(k.arg == "encoding" for k in node.keywords):
                continue
            missing.append(f"{source.name}:{node.lineno}")
    assert missing == []
