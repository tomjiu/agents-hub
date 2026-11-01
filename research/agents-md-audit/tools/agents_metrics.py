#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AGENTS-EN.md 量化指标分析：逐节指令密度/否定式约束/条件式激活/认知负荷"""
import json, os, re
from collections import Counter

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.normpath(os.path.join(_HERE, ".."))
SRC = os.path.join(_ROOT, "source", "AGENTS-EN.md")
OUT = os.path.join(_ROOT, "evidence", "metrics.json")

text = open(SRC, encoding="utf-8").read()
lines = text.splitlines()

# 分节
sections = []
cur, start = None, 0
for i, line in enumerate(lines):
    m = re.match(r"^#{1,3}\s+(.*)", line)
    if m:
        if cur is not None:
            sections.append((cur, start, i))
        cur, start = m.group(1), i
sections.append((cur, start, len(lines)))

NEG = re.compile(r"\b(Never|Do not|Don't|do not|never)\b")
COND = re.compile(r"\b(if|when|unless|before|after|While|while)\b")
IMP = re.compile(r"(?m)^\s*(?:[-*\d]+\s+)??\**\b([A-Z][a-z]+(?:ing|e)?)(?:\s+[a-z]+){0,12}\b")

# 文档级指标
words = re.findall(r"[A-Za-z][A-Za-z'-]*", text)
sentences = [s for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
token_est = len(words) * 1.35  # 英文近似
verbs_top = Counter(w for w in words if w.istitle() is False)

doc_metrics = {
    "total_words": len(words),
    "unique_words": len(set(w.lower() for w in words)),
    "type_token_ratio": round(len(set(w.lower() for w in words)) / len(words), 3),
    "sentence_count": len(sentences),
    "avg_sentence_len": round(len(words) / len(sentences), 1),
    "llm_token_estimate": round(token_est),
    "char_count": len(text),
    "negative_constraint_count": len(NEG.findall(text)),
    "conditional_activation_count": len(COND.findall(text)),
    "bullet_line_count": len([l for l in lines if re.match(r"^\s*[-*\d]", l)]),
    "code_block_count": len(re.findall(r"^```", text, re.M)) // 2,
    "bold_statement_count": len(re.findall(r"\*\*[^*]+\*\*", text)),
}

# 逐节指标
per_section = []
for title, s, e in sections:
    body = "\n".join(lines[s+1:e])
    w = re.findall(r"[A-Za-z][A-Za-z'-]*", body)
    if not w:
        continue
    per_section.append({
        "section": title[:50],
        "lines": f"{s+1}-{e}",
        "words": len(w),
        "negative": len(NEG.findall(body)),
        "conditional": len(COND.findall(body)),
        "neg_per_10w": round(len(NEG.findall(body)) / len(w) * 1000, 1),
        "bullets": len([l for l in lines[s+1:e] if re.match(r"^\s*[-*\d]", l)]),
    })

report = {"document": doc_metrics, "per_section": per_section}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(report, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

print("文档级:")
for k, v in doc_metrics.items():
    print(f"  {k}: {v}")
print("\n逐节(词数/否定式/条件式/每千词否定密度):")
for s in per_section:
    if s["words"] > 5:
        print(f"  {s['words']:>4}w  neg={s['negative']:>2}  cond={s['conditional']:>2}  {s['neg_per_10w']:>5}‰  {s['section'][:46]}")
