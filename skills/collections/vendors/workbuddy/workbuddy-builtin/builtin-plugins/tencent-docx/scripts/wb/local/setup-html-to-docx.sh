#!/usr/bin/env bash
# setup-html-to-docx.sh — Bootstrap Python 3.12 runtime for the html-to-docx skill.
#
# Why this exists:
#   HTML → docx 转换需要 python-docx + html-for-docx + lxml + Pillow 等 7 个依赖，
#   过去让 agent 每次调用时手工建 venv + pip install，一次冷启动 ~2min 40s。
#   本脚本把环境准备一次性做完并托管到 $HOME，绕开 IDE safe-delete 拦截 + 跨机器
#   venv 二进制损坏问题，也规避 lxml 在 Python 3.14 上无 wheel（需 libxml2/libxslt
#   源码编译）的坑（固化 --only-binary=:all: + Python 3.12）。
#
# ⚠️ 首次运行需要外网（幂等脚本首跑会访问以下三处公网）：
#   1. https://astral.sh/uv/install.sh                  — 装 uv（若本机未装）
#   2. astral-sh/python-build-standalone GitHub Releases — 拉 Python 3.12 独立发行版
#   3. https://pypi.org/simple                          — 下载 wheel
# 私有化 / 无外网环境：调用前请 export 以下环境变量指向内网镜像：
#   UV_INDEX_URL              -> 内网 PyPI 镜像（wheel）
#   UV_PYTHON_INSTALL_MIRROR  -> 内网 python-build-standalone 镜像
# 并预先把 uv 二进制分发到 $HOME/.local/bin/uv（脚本探测到已装则跳过 curl 安装）。
# 无外网且未配置镜像时首跑必然失败——这是已知交付前置条件，请先补齐镜像/离线 wheel。
#
# Output:
#   $HTML_TO_DOCX_VENV (default: ~/.venv-html-to-docx) 一个 Python 3.12 venv，
#   装齐 requirements.txt。打印可直接使用的解释器路径。
#
# Idempotent: 已就绪时秒退（只做一次 import 冒烟）。
#
# 布局兼容：本脚本可能位于两处
#   1. src 开发态：<repo>/src/scripts/wb/local/setup-html-to-docx.sh
#   2. plugin 部署态：<plugin_root>/scripts/wb/local/setup-html-to-docx.sh
# 通过探测同级 skills/ 目录判断，定位 html-to-docx skill 的 scripts/ 子目录
# （requirements.txt + html_to_docx 包所在处）。

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 定位 html-to-docx skill 目录（含 requirements.txt / html_to_docx 包）
# scripts/wb/local -> scripts/wb -> scripts -> root
if [ -d "$SCRIPT_DIR/../../../skills/html-to-docx/scripts" ]; then
    # plugin 布局：<plugin_root>/scripts/wb/local -> <plugin_root>/skills
    HTMLDOCX_DIR="$(cd "$SCRIPT_DIR/../../../skills/html-to-docx/scripts" && pwd)"
elif [ -d "$SCRIPT_DIR/../../../../src/skills/html-to-docx/scripts" ]; then
    # src 布局：<repo>/src/scripts/wb/local -> <repo>/src/skills
    HTMLDOCX_DIR="$(cd "$SCRIPT_DIR/../../../../src/skills/html-to-docx/scripts" && pwd)"
else
    echo "✗ 未找到 html-to-docx skill scripts 目录（含 requirements.txt / html_to_docx 包）" >&2
    echo "  SCRIPT_DIR=$SCRIPT_DIR" >&2
    exit 1
fi

VENV_DIR="${HTML_TO_DOCX_VENV:-$HOME/.venv-html-to-docx}"
PY_VERSION="3.12"
REQ_FILE="$HTMLDOCX_DIR/requirements.txt"

log()  { echo "  $*"; }
step() { echo "▶ $*"; }
ok()   { echo "✓ $*"; }

# --- 1. Ensure uv is installed (lightweight, no sudo required) ---
if ! command -v uv >/dev/null 2>&1; then
    if [ -x "$HOME/.local/bin/uv" ]; then
        export PATH="$HOME/.local/bin:$PATH"
    else
        # ⚠️ 首次外网点 1/3：从 astral.sh 拉 uv 安装器。
        # 私有化环境请预先把 uv 二进制放到 $HOME/.local/bin/uv（脚本会命中上一分支跳过）。
        step "Installing uv (Python version manager) — requires network to astral.sh"
        if ! curl -LsSf https://astral.sh/uv/install.sh 2>/dev/null | sh >/dev/null 2>&1; then
            echo "✗ uv 安装失败：无法访问 https://astral.sh/uv/install.sh" >&2
            echo "  私有化环境请先把 uv 二进制部署到 \$HOME/.local/bin/uv 后重试；" >&2
            echo "  或联系运维拉取 https://github.com/astral-sh/uv/releases 对应平台的 wheel。" >&2
            exit 1
        fi
        export PATH="$HOME/.local/bin:$PATH"
        ok "uv installed at $HOME/.local/bin/uv"
    fi
fi

# --- 2. Ensure Python 3.12 is available via uv ---
if ! uv python find "$PY_VERSION" >/dev/null 2>&1; then
    step "Installing Python $PY_VERSION via uv"
    uv python install "$PY_VERSION" >/dev/null 2>&1
fi
ok "Python $PY_VERSION available"

# --- 3. Create venv if missing or wrong Python version ---
if [ ! -x "$VENV_DIR/bin/python" ] || ! "$VENV_DIR/bin/python" --version 2>&1 | grep -q "Python 3.12"; then
    step "Creating venv at $VENV_DIR"
    rm -rf "$VENV_DIR"
    uv venv --python "$PY_VERSION" "$VENV_DIR" >/dev/null 2>&1
fi
ok "venv ready: $VENV_DIR"

# --- 4. Install runtime dependencies (only when missing) ---
PY="$VENV_DIR/bin/python"
NEED_INSTALL=false
# 检查关键包 import 是否可用；任一缺失即触发安装
for mod in docx htmldocx bs4 lxml httpx PIL click; do
    "$PY" -c "import $mod" 2>/dev/null || { NEED_INSTALL=true; break; }
done

if [ "$NEED_INSTALL" = true ]; then
    step "Installing html-to-docx dependencies (only-binary wheels)"
    # 强制仅用 wheel，避免 lxml 在无 libxml2/libxslt 环境下源码构建失败
    uv pip install --quiet --python "$PY" --only-binary=:all: -r "$REQ_FILE" >/dev/null 2>&1
fi
ok "dependencies installed"

# --- 5. Smoke-test: import the html_to_docx package ---
if ! "$PY" -c "
import sys
sys.path.insert(0, '$HTMLDOCX_DIR')
import html_to_docx  # noqa: F401
" 2>/dev/null; then
    echo "✗ Smoke test failed — html_to_docx package did not import. Check $VENV_DIR."
    exit 1
fi
ok "html_to_docx package loads successfully"

echo ""
echo "Python runner: $PY"
echo ""
echo "Usage:"
echo "  $PY -m html_to_docx convert input.html -o output.docx"
echo ""
echo "Or export for your shell:"
echo "  export HTML_TO_DOCX_PY=\"$PY\""
