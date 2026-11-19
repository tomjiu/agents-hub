"""test_em_resolve.py — US2: em resolved against element font-size (FR-001 / SC-002).

Covers:
  - AC1: font-size:22pt; margin-bottom:0.5em → space_after == Pt(11)
  - AC2: font-size:9pt; text-indent:2em → first_line_indent == Pt(18)
  - AC3: no font-size + margin-bottom:0.5em → fallback Pt(6), no error
  - AC4: margin:10pt absolute → Pt(10), unaffected by em
  - Decision-lock: no font-size em result == legacy num*12
  - line-height em conversion (sensitive to font-size)
  - _parse_size_to_pt / _parse_size_to_cm em_base_pt semantics
"""
from __future__ import annotations

from docx import Document
from docx.shared import Pt, Cm

from html_to_docx.style_mapper import (
    apply_paragraph_styles,
    _parse_size_to_pt,
    _parse_size_to_cm,
)

# EMU tolerance (1 pt = 12700 EMU); allow rounding from cm round-trip.
_TOL_EMU = 6000


def _make_para(text: str = "test"):
    doc = Document()
    return doc.add_paragraph(text)


# --- unit-level: _parse_size_to_pt em_base ---------------------------------

def test_parse_pt_em_with_base():
    assert _parse_size_to_pt("0.5em", em_base_pt=22.0) == 11.0
    assert _parse_size_to_pt("2em", em_base_pt=9.0) == 18.0


def test_parse_pt_em_default_fallback_12():
    # No base → legacy behavior num * 12
    assert _parse_size_to_pt("0.5em") == 6.0
    assert _parse_size_to_pt("0.5em", em_base_pt=None) == 6.0
    assert _parse_size_to_pt("1em") == 12.0


def test_parse_pt_absolute_unaffected_by_base():
    # Absolute units ignore em_base entirely
    assert _parse_size_to_pt("10pt", em_base_pt=22.0) == 10.0
    assert _parse_size_to_pt("16px", em_base_pt=22.0) == 16 * 0.75


def test_parse_pt_unparseable_returns_none():
    assert _parse_size_to_pt("garbage") is None
    assert _parse_size_to_pt("garbage", em_base_pt=22.0) is None


def test_parse_cm_em_with_base():
    # 2em at base 9pt = 18pt → cm equivalent
    cm = _parse_size_to_cm("2em", em_base_pt=9.0)
    assert cm is not None
    assert abs(cm - 18 / 28.3465) < 1e-6


def test_parse_cm_em_default_fallback_12():
    # 0.5em with no base = 6pt → cm
    cm = _parse_size_to_cm("0.5em")
    assert cm is not None
    assert abs(cm - 6 / 28.3465) < 1e-6


# --- integration: apply_paragraph_styles -----------------------------------

def test_ac1_fontsize_drives_margin_em():
    para = _make_para()
    apply_paragraph_styles(para, "font-size:22pt; margin-bottom:0.5em")
    assert para.paragraph_format.space_after == Pt(11)


def test_ac2_fontsize_drives_textindent_em():
    para = _make_para()
    apply_paragraph_styles(para, "font-size:9pt; text-indent:2em")
    fli = para.paragraph_format.first_line_indent
    assert fli is not None
    assert abs(int(fli) - int(Pt(18))) < _TOL_EMU


def test_ac3_no_fontsize_em_fallback_no_error():
    para = _make_para()
    apply_paragraph_styles(para, "margin-bottom:0.5em")
    assert para.paragraph_format.space_after == Pt(6)


def test_ac4_absolute_margin_unaffected():
    para = _make_para()
    apply_paragraph_styles(para, "margin:10pt")
    # margin shorthand maps to margin-top/bottom → both 10pt (no em scaling)
    assert para.paragraph_format.space_after == Pt(10) or \
        para.paragraph_format.space_before == Pt(10)


def test_decision_lock_no_fontsize_equals_legacy_num_times_12():
    """Decision-lock (R3 keep legacy path): no font-size em == num*12."""
    para = _make_para()
    apply_paragraph_styles(para, "margin-bottom:0.5em")
    # legacy: 0.5 * 12 = 6pt
    assert para.paragraph_format.space_after == Pt(0.5 * 12)


def test_lineheight_em_conversion_with_fontsize():
    para = _make_para()
    apply_paragraph_styles(para, "font-size:10pt; line-height:1.5em")
    # 1.5em at base 10pt = 15pt fixed spacing
    assert para.paragraph_format.line_spacing == Pt(15)


def test_lineheight_em_fallback_no_fontsize():
    para = _make_para()
    apply_paragraph_styles(para, "line-height:1.5em")
    # fallback base 12pt → 18pt
    assert para.paragraph_format.line_spacing == Pt(18)
