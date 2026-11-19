"""Tests for html_to_docx.section_model (US1 — 语义 Section 隐式分节).

Spec: S-26060126E FR-001~007 / SC-001 / SC-008 / Smoke 1/2/8.

TDD: these tests are written before the implementation (red → green).
"""
from __future__ import annotations

import warnings

import pytest
from bs4 import BeautifulSoup
from docx import Document
from docx.enum.section import WD_ORIENT
from docx.shared import Cm

from html_to_docx.section_model import (
    SectionSpec,
    parse_sections,
    mark_section_boundaries,
    apply_sections,
)
from html_to_docx.page_setup import resolve_page_defaults, PageDefaults


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _soup(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "lxml")


def _default_defaults() -> PageDefaults:
    """A4 portrait, top/bottom=2.54, left/right=3.17 — the documented baseline."""
    return resolve_page_defaults("<html><body></body></html>", None)


# ---------------------------------------------------------------------------
# parse_sections — AC1/AC2/AC3/AC4/AC5 + edge cases
# ---------------------------------------------------------------------------

def test_parse_three_sections_order_and_index():
    """AC1 / AC5: 3 sections parsed in DOM order with auto 0..N-1 indices."""
    html = (
        "<body>"
        "<section role='cover'><h1>C</h1></section>"
        "<section role='toc'><h1>T</h1></section>"
        "<section role='body'><h1>B</h1></section>"
        "</body>"
    )
    specs = parse_sections(_soup(html))
    assert len(specs) == 3
    assert [s.index for s in specs] == [0, 1, 2]
    assert [s.role for s in specs] == ["cover", "toc", "body"]


def test_parse_landscape_orientation():
    """AC2: data-orientation=landscape parsed; recorded in explicit_attrs."""
    html = "<body><section data-orientation='landscape'><p>x</p></section></body>"
    specs = parse_sections(_soup(html))
    assert specs[0].orientation == "landscape"
    assert "orientation" in specs[0].explicit_attrs


def test_parse_margins_cm():
    """AC3: data-margin-* parsed as cm floats; only set ones in explicit_attrs."""
    html = (
        "<body><section data-margin-top='3' data-margin-left='2.5'>"
        "<p>x</p></section></body>"
    )
    specs = parse_sections(_soup(html))
    s = specs[0]
    assert s.margin_top == 3.0
    assert s.margin_left == 2.5
    assert s.margin_bottom is None
    assert s.margin_right is None
    assert "margin_top" in s.explicit_attrs
    assert "margin_left" in s.explicit_attrs
    assert "margin_bottom" not in s.explicit_attrs
    assert "margin_right" not in s.explicit_attrs


def test_parse_page_restart():
    html = "<body><section data-page-restart='1'><p>x</p></section></body>"
    specs = parse_sections(_soup(html))
    assert specs[0].page_restart == 1
    assert "page_restart" in specs[0].explicit_attrs


def test_parse_no_section_single_spec():
    """AC4: no <section> -> single SectionSpec(index=0, all None)."""
    html = "<body><h1>Legacy</h1><p>content</p></body>"
    specs = parse_sections(_soup(html))
    assert len(specs) == 1
    assert specs[0].index == 0
    assert specs[0].role is None
    assert specs[0].orientation is None
    assert specs[0].explicit_attrs == set()


def test_parse_invalid_orientation_warns_and_none():
    html = "<body><section data-orientation='diagonal'><p>x</p></section></body>"
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        specs = parse_sections(_soup(html))
    assert specs[0].orientation is None
    assert "orientation" not in specs[0].explicit_attrs
    assert any("orientation" in str(w.message).lower() for w in caught)


def test_parse_invalid_margin_none_no_error():
    html = "<body><section data-margin-top='abc'><p>x</p></section></body>"
    specs = parse_sections(_soup(html))
    assert specs[0].margin_top is None
    assert "margin_top" not in specs[0].explicit_attrs


def test_parse_invalid_page_restart_warns():
    html = "<body><section data-page-restart='0'><p>x</p></section></body>"
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        specs = parse_sections(_soup(html))
    assert specs[0].page_restart is None
    assert any("page-restart" in str(w.message).lower()
               or "page_restart" in str(w.message).lower() for w in caught)


def test_parse_nested_section_only_top_level_warns():
    """Edge: nested <section> -> only top-level counts; inner demoted + warning."""
    html = (
        "<body><section role='outer'>"
        "<p>a</p><section role='inner'><p>b</p></section>"
        "</section></body>"
    )
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        specs = parse_sections(_soup(html))
    assert len(specs) == 1
    assert specs[0].role == "outer"
    assert any("nest" in str(w.message).lower() for w in caught)


# ---------------------------------------------------------------------------
# mark_section_boundaries
# ---------------------------------------------------------------------------

def test_mark_section_boundaries_injects_markers():
    html = (
        "<body>"
        "<section role='cover'><h1>C</h1></section>"
        "<section role='body'><h1>B</h1></section>"
        "</body>"
    )
    soup = _soup(html)
    specs = parse_sections(soup)
    out_html = mark_section_boundaries(soup, specs)
    # Each section spec gets a boundary_marker assigned.
    assert all(s.boundary_marker for s in specs)
    # Markers appear in the returned HTML so html4docx carries them through.
    for s in specs:
        assert s.boundary_marker in out_html


# ---------------------------------------------------------------------------
# apply_sections — end-to-end via converter is heavy; test core merge here
# ---------------------------------------------------------------------------

def _build_doc_with_markers(html: str):
    """Run parse + mark + html4docx to get a doc with boundary markers."""
    from html4docx import HtmlToDocx
    soup = _soup(html)
    specs = parse_sections(soup)
    marked = mark_section_boundaries(soup, specs)
    doc = Document()
    HtmlToDocx().add_html_to_document(marked, doc)
    return doc, specs


def test_apply_sections_three_sections_count():
    """SC-001: N sections -> len(document.sections) == N."""
    html = (
        "<body>"
        "<section role='cover'><h1>Cover</h1></section>"
        "<section role='toc'><h1>Toc</h1></section>"
        "<section role='body'><h1>Body</h1></section>"
        "</body>"
    )
    doc, specs = _build_doc_with_markers(html)
    apply_sections(doc, specs, _default_defaults())
    assert len(doc.sections) == 3


def test_apply_sections_landscape_swaps_dimensions():
    """AC2: landscape section -> WD_ORIENT.LANDSCAPE and width>height (from defaults)."""
    html = (
        "<body>"
        "<section role='body'><h1>Portrait</h1></section>"
        "<section data-orientation='landscape'><h1>Land</h1></section>"
        "</body>"
    )
    doc, specs = _build_doc_with_markers(html)
    apply_sections(doc, specs, _default_defaults())
    land = doc.sections[1]
    assert land.orientation == WD_ORIENT.LANDSCAPE
    assert land.page_width > land.page_height
    # dimensions come from defaults (A4) swapped, not hard-coded
    assert abs(land.page_width.cm - 29.7) < 0.05
    assert abs(land.page_height.cm - 21.0) < 0.05


def test_apply_sections_partial_margin_per_property_merge():
    """q2: only data-margin-top set -> others fall back to defaults (3.17/2.54)."""
    html = (
        "<body>"
        "<section data-margin-top='3'><h1>X</h1></section>"
        "</body>"
    )
    doc, specs = _build_doc_with_markers(html)
    apply_sections(doc, specs, _default_defaults())
    sec = doc.sections[0]
    assert abs(sec.top_margin.cm - 3.0) < 0.05      # section value
    assert abs(sec.left_margin.cm - 3.17) < 0.05    # default
    assert abs(sec.right_margin.cm - 3.17) < 0.05   # default
    assert abs(sec.bottom_margin.cm - 2.54) < 0.05  # default


def test_apply_sections_page_restart_writes_start():
    """FR-005: data-page-restart=1 -> sectPr/pgNumType@w:start=1."""
    html = "<body><section data-page-restart='1'><h1>X</h1></section></body>"
    doc, specs = _build_doc_with_markers(html)
    apply_sections(doc, specs, _default_defaults())
    assert 'w:start="1"' in doc.sections[0]._sectPr.xml


def test_apply_sections_no_section_backward_compat():
    """SC-008: no <section> -> single section, defaults applied, == prior behavior."""
    html = "<body><h1>Legacy</h1><p>content</p></body>"
    doc, specs = _build_doc_with_markers(html)
    apply_sections(doc, specs, _default_defaults())
    assert len(doc.sections) == 1
    sec = doc.sections[0]
    assert sec.orientation == WD_ORIENT.PORTRAIT
    assert abs(sec.page_width.cm - 21.0) < 0.05
    assert abs(sec.top_margin.cm - 2.54) < 0.05
    assert abs(sec.left_margin.cm - 3.17) < 0.05


def test_apply_sections_markers_cleared():
    """Boundary markers must be removed from output text after apply."""
    html = (
        "<body>"
        "<section role='cover'><h1>Cover</h1></section>"
        "<section role='body'><h1>Body</h1></section>"
        "</body>"
    )
    doc, specs = _build_doc_with_markers(html)
    apply_sections(doc, specs, _default_defaults())
    full_text = "\n".join(p.text for p in doc.paragraphs)
    for s in specs:
        if s.boundary_marker:
            assert s.boundary_marker not in full_text
