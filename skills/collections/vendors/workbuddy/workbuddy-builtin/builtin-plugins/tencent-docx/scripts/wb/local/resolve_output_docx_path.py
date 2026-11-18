#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
resolve_output_docx_path.py — Stage 0 最终 .docx 交付路径 resolve + 父目录预建。

用法:
  python3 resolve_output_docx_path.py \\
    --workspace <workspace> \\
    [--user-path <用户路径>] \\
    [--request-id <request_id>] \\
    [--filename <文件名>.docx]

规则:
  - 提供 --user-path: resolve 为绝对路径（相对路径相对 workspace）
  - 未提供 --user-path: 必须提供 --filename
      - 有 --request-id → <workspace>/output/<request_id>/stage3/<filename>
      - 无 --request-id → <workspace>/output/<filename>（brief-compose 等）

成功 stdout JSON:
  {"success": true, "output_docx_path": "/abs/path.docx", "output_docx_user_specified": bool}

失败 stderr JSON + exit 1:
  {"success": false, "error": "..."}
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def _fail(message: str) -> None:
    print(json.dumps({"success": False, "error": message}, ensure_ascii=False), file=sys.stderr)
    sys.exit(1)


def _ok(path: Path, user_specified: bool) -> None:
    print(
        json.dumps(
            {
                "success": True,
                "output_docx_path": str(path),
                "output_docx_user_specified": user_specified,
            },
            ensure_ascii=False,
        )
    )


def _validate_docx_name(name: str, label: str) -> None:
    if not name or not name.strip():
        _fail(f"{label} 不能为空")
    if not name.lower().endswith(".docx"):
        _fail(f"{label} 必须以 .docx 结尾")
    stem = Path(name).stem
    if not stem or stem in {".", ".."}:
        _fail(f"{label} 文件名无效: {name}")


def _ensure_parent(path: Path) -> None:
    parent = path.parent
    if path.exists() and path.is_dir():
        _fail(f"目标路径是目录而非文件: {path}")
    try:
        os.makedirs(parent, exist_ok=True)
    except OSError as exc:
        _fail(f"无法创建父目录 {parent}: {exc}")


def resolve_user_path(raw: str, workspace: Path) -> Path:
    raw = raw.strip()
    if not raw:
        _fail("--user-path 不能为空字符串；未指定路径时请省略该参数并提供 --filename")
    _validate_docx_name(Path(raw).name, "user-path")
    candidate = Path(raw)
    resolved = candidate if candidate.is_absolute() else workspace / candidate
    resolved = resolved.resolve()
    if not str(resolved).lower().endswith(".docx"):
        _fail("resolve 后路径必须以 .docx 结尾")
    return resolved


def resolve_default_path(
    workspace: Path,
    filename: str,
    request_id: str | None,
) -> Path:
    _validate_docx_name(filename, "filename")
    safe_name = Path(filename).name
    if request_id:
        path = workspace / "output" / request_id / "stage3" / safe_name
    else:
        path = workspace / "output" / safe_name
    return path.resolve()


def main() -> None:
    parser = argparse.ArgumentParser(description="Resolve final .docx delivery path")
    parser.add_argument("--workspace", required=True, help="工作区根目录（绝对路径）")
    parser.add_argument("--user-path", default="", help="用户指定的 .docx 路径；未指定则留空")
    parser.add_argument("--request-id", default="", help="Pipeline request_id（默认落盘模式）")
    parser.add_argument("--filename", default="", help="未指定 user-path 时的文件名，如 股权转让协议.docx")
    args = parser.parse_args()

    workspace = Path(args.workspace).expanduser()
    if not workspace.is_absolute():
        workspace = workspace.resolve()
    if not workspace.is_dir():
        _fail(f"workspace 不存在或不是目录: {workspace}")

    user_path = (args.user_path or "").strip()
    request_id = (args.request_id or "").strip() or None
    filename = (args.filename or "").strip()

    if user_path:
        resolved = resolve_user_path(user_path, workspace)
        user_specified = True
    else:
        if not filename:
            _fail("未提供 --user-path 时必须提供 --filename")
        resolved = resolve_default_path(workspace, filename, request_id)
        user_specified = False

    _ensure_parent(resolved)
    _ok(resolved, user_specified)


if __name__ == "__main__":
    main()
