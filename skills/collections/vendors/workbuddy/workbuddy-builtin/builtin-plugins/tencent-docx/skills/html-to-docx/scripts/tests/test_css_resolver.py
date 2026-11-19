"""Unit tests for html_to_docx.css_resolver.resolve()."""
from __future__ import annotations

import pytest
from bs4 import BeautifulSoup

from html_to_docx.css_resolver import resolve


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _style_attr(html: str, tag: str = "p") -> str:
    """Return the style attribute value of the first matching tag."""
    soup = BeautifulSoup(html, "lxml")
    el = soup.find(tag)
    assert el is not None, f"No <{tag}> found in: {html!r}"
    return el.get("style", "")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_extract_root_vars():
    """Variables declared in :root are resolved in the output."""
    html = """
    <style>:root { --color: blue; } p { color: var(--color); }</style>
    <p style="color: var(--color);">text</p>
    """
    result = resolve(html)
    assert "color: blue" in result
    assert "var(--color)" not in result


def test_simple_replace():
    """`var(--c)` is replaced with the variable value."""
    html = '<style>:root{--c:red}</style><p style="color:var(--c)">x</p>'
    result = resolve(html)
    assert "color:red" in result
    assert "var(--c)" not in result


def test_fallback_value():
    """`var(--undefined, red)` falls back to `red` when var is not defined."""
    html = '<p style="color: var(--undefined, red);">text</p>'
    result = resolve(html)
    style = _style_attr(result)
    assert "red" in style
    assert "var(" not in style


def test_nested_var():
    """A variable whose value contains another var() is fully expanded."""
    html = """
    <style>
      :root {
        --color: #3498db;
        --border: 1px solid var(--color);
      }
    </style>
    <p style="border: var(--border);">text</p>
    """
    result = resolve(html)
    style = _style_attr(result)
    assert "#3498db" in style
    assert "var(" not in style


def test_max_recursion_depth():
    """Deeply nested vars (>3 levels) do not cause infinite recursion."""
    html = """
    <style>
      :root {
        --a: var(--b);
        --b: var(--c);
        --c: var(--d);
        --d: var(--a);
      }
    </style>
    <p style="color: var(--a);">text</p>
    """
    # Should not raise; must not crash
    result = resolve(html)
    assert isinstance(result, str)


def test_undefined_var_uses_fallback():
    """An undefined variable with a fallback uses the fallback value."""
    html = '<p style="margin: var(--not-defined, 10px);">text</p>'
    result = resolve(html)
    style = _style_attr(result)
    assert "10px" in style
    assert "var(" not in style


def test_multiple_root_blocks():
    """Variables from multiple :root blocks are all resolved."""
    html = """
    <style>:root { --a: red; }</style>
    <style>:root { --b: blue; }</style>
    <p style="color: var(--a); background: var(--b);">text</p>
    """
    result = resolve(html)
    style = _style_attr(result)
    assert "red" in style
    assert "blue" in style
    assert "var(" not in style


def test_self_referential_var_uses_inline_fallback():
    """`--x: var(--x, DEFAULT);` — a self-reference — must expand to the
    inline fallback DEFAULT when the call site has no fallback."""
    html = """
    <style>
      :root {
        --color-border: var(--color-border, #C9B99A);
      }
      td { border: 1px solid var(--color-border); }
    </style>
    <td style="border: 1px solid var(--color-border);">x</td>
    """
    result = resolve(html)
    style = _style_attr(result, "td")
    assert "#C9B99A" in style
    assert "var(" not in style


def test_self_referential_var_prefers_call_site_fallback():
    """When both the declaration and the call site have fallbacks, the
    call-site fallback wins (matches CSS override semantics)."""
    html = """
    <style>:root { --c: var(--c, red); }</style>
    <p style="color: var(--c, blue);">x</p>
    """
    result = resolve(html)
    style = _style_attr(result)
    assert "blue" in style
    assert "red" not in style
    assert "var(" not in style


def test_inline_style_resolve():
    """var() in inline style attributes is resolved."""
    html = """
    <style>:root { --fs: 14px; --pad: 8px; }</style>
    <div style="font-size: var(--fs); padding: var(--pad);">content</div>
    """
    result = resolve(html)
    soup = BeautifulSoup(result, "lxml")
    div_style = soup.find("div").get("style", "")
    assert "14px" in div_style
    assert "8px" in div_style
    assert "var(" not in div_style
