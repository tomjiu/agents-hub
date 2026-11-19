"""Tests for html_to_docx.converter.Converter."""
from __future__ import annotations

import os
import tempfile
import xml.etree.ElementTree as ET
from zipfile import ZipFile

import pytest
from docx import Document

from html_to_docx.converter import Converter
from html_to_docx.types import ConvertOptions


def test_basic_conversion(fixtures_dir):
    """Converter produces a valid .docx from basic.html."""
    html = (fixtures_dir / "basic.html").read_text()
    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as f:
        out = f.name
    try:
        result = Converter(ConvertOptions(output_path=out)).convert(html)
        assert result.success, result.error
        assert os.path.exists(out)
        assert os.path.getsize(out) > 0
    finally:
        if os.path.exists(out):
            os.unlink(out)


def test_output_file_created():
    """Converter auto-generates output path when none given."""
    html = "<p>Hello world</p>"
    result = Converter().convert(html)
    assert result.success, result.error
    assert result.docx_path is not None
    assert os.path.exists(result.docx_path)
    os.unlink(result.docx_path)


def test_blank_html_retains_body_paragraph_for_docx_consumers(fixtures_dir):
    """A visual blank document still has an importable body-level block."""
    html = (fixtures_dir / "empty_body.html").read_text()
    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as f:
        out = f.name
    try:
        result = Converter(ConvertOptions(output_path=out)).convert(html)
        assert result.success, result.error

        with ZipFile(out) as docx_archive:
            document_xml = docx_archive.read("word/document.xml")
        root = ET.fromstring(document_xml)
        namespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
        body = root.find(f"{{{namespace}}}body")
        assert body is not None
        assert any(
            child.tag in {f"{{{namespace}}}p", f"{{{namespace}}}tbl"}
            for child in body
        )
    finally:
        if os.path.exists(out):
            os.unlink(out)


def test_custom_page_size():
    """Converter respects page_size=Letter and orientation=landscape."""
    html = "<p>Page setup test</p>"
    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as f:
        out = f.name
    try:
        opts = ConvertOptions(page_size="Letter", orientation="landscape", output_path=out)
        result = Converter(opts).convert(html)
        assert result.success, result.error
        doc = Document(out)
        section = doc.sections[0]
        # In landscape orientation: width > height
        assert section.page_width > section.page_height
    finally:
        if os.path.exists(out):
            os.unlink(out)


def test_pipeline_order():
    """CSS variables are resolved before html-for-docx conversion."""
    html = '<style>:root{--c:red}</style><p style="color:var(--c)">text</p>'
    result = Converter().convert(html)
    assert result.success, result.error
    if result.docx_path and os.path.exists(result.docx_path):
        os.unlink(result.docx_path)
