#!/usr/bin/env bash
# setup-rerank.sh — 批 27/28: SC_RERANK 增强模式部署件一键安装
# 三件套: libonnxruntime.so (C API 1.29.0, 与 yalue/onnxruntime_go v1.36 头对齐)
#         model_quantized.onnx (ms-marco-MiniLM-L-6-v2 quantized, 22MB)
#         tokenizer.json (Xenova 格式, Go 侧加载 model.vocab)
# 版本对齐铁律 (b27 排坑④): 绑定头 ORT_API_VERSION=29 ↔ C 库 1.29.0 —
#   GitHub release 1.18/1.20/1.21 全不匹配; 1.29 从 pip wheel 抽最稳。
# 用法: bash scripts/setup-rerank.sh [目标目录, 缺省 ~/.cache/searchcore-rerank]
# 完成后按脚本输出配置 SC_RERANK_LIB/MODEL/VOCAB + SC_RERANK=1。
set -e
DEST="${1:-$HOME/.cache/searchcore-rerank}"
mkdir -p "$DEST"
echo "== searchcore 重排增强部署件 -> $DEST =="

# ---------- 1) libonnxruntime.so 1.29.0 ----------
if [ -f "$DEST/libonnxruntime.so" ]; then
  echo "[skip] libonnxruntime.so 已存在"
else
  PYORT=$(python3 - <<'EOF'
try:
    import onnxruntime, os
    p = os.path.join(os.path.dirname(onnxruntime.__file__), "capi")
    for f in sorted(os.listdir(p)):
        if f.startswith("libonnxruntime.so"):
            print(os.path.join(p, f)); break
except Exception:
    pass
EOF
)
  if [ -n "$PYORT" ]; then
    cp "$PYORT" "$DEST/libonnxruntime.so.1.29.0"
    echo "[ok] 从 pip wheel 抽取: $PYORT"
  else
    echo "[..] pip 无 onnxruntime, 安装 (清华镜像)..."
    pip3 install -q onnxruntime -i https://pypi.tuna.tsinghua.edu.cn/simple || \
      pip3 install -q onnxruntime -i https://mirrors.aliyun.com/pypi/simple/
    PYORT=$(python3 -c "import onnxruntime, os; p=os.path.join(os.path.dirname(onnxruntime.__file__),'capi'); print(os.path.join(p, [f for f in sorted(os.listdir(p)) if f.startswith('libonnxruntime.so')][0]))")
    cp "$PYORT" "$DEST/libonnxruntime.so.1.29.0"
  fi
  ln -sf libonnxruntime.so.1.29.0 "$DEST/libonnxruntime.so"
fi

# ---------- 2) model + tokenizer ----------
BASE="https://hf-mirror.com/Xenova/ms-marco-MiniLM-L-6-v2/resolve/main"
if [ ! -f "$DEST/model_quantized.onnx" ]; then
  echo "[..] 下载 model_quantized.onnx (22MB)..."
  curl -sL --fail -o "$DEST/model_quantized.onnx" "$BASE/onnx/model_quantized.onnx"
else
  echo "[skip] model_quantized.onnx 已存在"
fi
if [ ! -f "$DEST/tokenizer.json" ]; then
  echo "[..] 下载 tokenizer.json..."
  curl -sL --fail -o "$DEST/tokenizer.json" "$BASE/tokenizer.json"
else
  echo "[skip] tokenizer.json 已存在"
fi

ls -la "$DEST"
cat <<EOF

== 部署完成, 使用方式 ==
  export SC_RERANK=1
  export SC_RERANK_LIB=$DEST/libonnxruntime.so
  export SC_RERANK_MODEL=$DEST/model_quantized.onnx
  export SC_RERANK_VOCAB=$DEST/tokenizer.json
  # 可选: SC_RERANK_POOL(缺省 10) SC_RERANK_LAMBDA(缺省 4) SC_RERANK_THREADS(缺省 NumCPU)
验证: ./search-core-go search "who directed Stagecoach" --json true --topn 5
  stderr 无 [rerank] 失败行 + journal 出现 "event":"rerank" 即生效。
EOF
