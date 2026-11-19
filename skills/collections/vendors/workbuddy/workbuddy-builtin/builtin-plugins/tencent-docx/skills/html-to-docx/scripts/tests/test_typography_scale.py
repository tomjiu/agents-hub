"""test_typography_scale.py — US5: design-token fontSize gradient (FR-007 / SC-005).

Validates business-modern.json typography.fontSize:
  - contains the 8 target keys (coverTitle/coverCategory/sectionHeader/h2/h3/body/small/tiny)
  - strictly decreasing gradient (coverCategory >= sectionHeader allowed equal)
  - original title/subtitle/h1/caption/dataLabel still present
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

_TOKEN_PATH = (
    Path(__file__).resolve().parents[3]
    / "design-token"
    / "tokens"
    / "themes"
    / "business-modern.json"
)


def _load_font_sizes() -> dict[str, float]:
    data = json.loads(_TOKEN_PATH.read_text(encoding="utf-8"))
    font_size = data["typography"]["fontSize"]
    out: dict[str, float] = {}
    for key, spec in font_size.items():
        assert spec.get("$type") == "dimension", f"{key} must be dimension"
        m = re.match(r"^([\d.]+)pt$", spec["$value"].strip())
        assert m, f"{key} $value must be 'Npt', got {spec['$value']!r}"
        out[key] = float(m.group(1))
    return out


def test_token_file_exists():
    assert _TOKEN_PATH.is_file(), f"token file missing: {_TOKEN_PATH}"


def test_eight_target_keys_present():
    sizes = _load_font_sizes()
    for key in (
        "coverTitle",
        "coverCategory",
        "sectionHeader",
        "h2",
        "h3",
        "body",
        "small",
        "tiny",
    ):
        assert key in sizes, f"missing fontSize token: {key}"


def test_original_keys_preserved():
    sizes = _load_font_sizes()
    for key in ("title", "subtitle", "h1", "caption", "dataLabel"):
        assert key in sizes, f"original fontSize token removed: {key}"


def test_strictly_decreasing_gradient():
    s = _load_font_sizes()
    # coverTitle(22) > coverCategory(14) >= sectionHeader(13) > h2(11)
    #   > h3(10) > body(9) > small(8) > tiny(7)
    assert s["coverTitle"] > s["coverCategory"]
    assert s["coverCategory"] >= s["sectionHeader"]  # boundary equal allowed
    assert s["sectionHeader"] > s["h2"]
    assert s["h2"] > s["h3"]
    assert s["h3"] > s["body"]
    assert s["body"] > s["small"]
    assert s["small"] > s["tiny"]


def test_expected_values():
    s = _load_font_sizes()
    assert s["coverTitle"] == 22
    assert s["coverCategory"] == 14
    assert s["sectionHeader"] == 13
    assert s["h2"] == 11
    assert s["h3"] == 10
    assert s["body"] == 9
    assert s["small"] == 8
    assert s["tiny"] == 7
