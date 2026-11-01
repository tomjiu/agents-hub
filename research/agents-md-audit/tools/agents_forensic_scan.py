#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AGENTS-EN.md 深度取证扫描器
检测休眠/隐藏恶意载荷的全部已知载体:
  1. 零宽字符 (U+200B-200F, U+2060-2064, U+FEFF) —— 隐写水印/隐藏分词
  2. Bidi 控制字符 (U+202A-202E, U+2066-2069) —— Trojan Source 攻击
  3. Tag 字符块 (U+E0000-U+E007F) —— 隐藏文本注入
  4. 变体选择符 (U+FE00-FE0F) —— 隐藏标识
  5. 同形字混淆 (西里尔/希腊冒充拉丁)
  6. ANSI/终端转义序列
  7. 长连续 Base64/Hex 块 (可疑载荷)
  8. URL / Markdown 链接目标提取
  9. 提示注入关键词与危险命令模式
 10. 逐节熵值 (定位异常密度区域)
 11. 非 ASCII 码点全量清单
"""
import json, math, re, unicodedata
import os
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.normpath(os.path.join(_HERE, ".."))
from collections import Counter, OrderedDict

SRC = os.path.join(_ROOT, "source", "AGENTS-EN.md")
OUT = os.path.join(_ROOT, "evidence", "forensic-scan.json")

raw = open(SRC, "rb").read()
text = raw.decode("utf-8")  # 若失败会抛异常，本身就是发现
lines = text.splitlines()

report = OrderedDict()
report["file"] = SRC
report["size_bytes"] = len(raw)
report["line_count"] = len(lines)
report["sha256"] = __import__("hashlib").sha256(raw).hexdigest()
report["md5"] = __import__("hashlib").md5(raw).hexdigest()
report["bom"] = raw[:3] == b"\xef\xbb\xbf"
report["crlf"] = raw.count(b"\r\n")
report["lone_cr"] = raw.count(b"\r") - raw.count(b"\r\n")
report["utf8_decodable"] = True

# ---------- 1-4: 隐形字符扫描 ----------
invisible_ranges = {
    "U+200B ZERO WIDTH SPACE":        (0x200B,),
    "U+200C ZWNJ":                    (0x200C,),
    "U+200D ZWJ":                     (0x200D,),
    "U+200E/U+200E LRM/RLM":          (0x200E, 0x200F),
    "U+202A-202E Bidi controls":      tuple(range(0x202A, 0x202F)),
    "U+2060-2064 word joiners":       tuple(range(0x2060, 0x2065)),
    "U+2066-2069 Bidi isolates":      tuple(range(0x2066, 0x206A)),
    "U+FEFF BOM/ZWNBSP":              (0xFEFF,),
    "U+FE00-FE0F variation selectors": tuple(range(0xFE00, 0xFE10)),
    "U+E0000-E007F TAG characters":   tuple(range(0xE0000, 0xE0080)),
    "U+FFF9-FFFB interlinear":        (0xFFF9, 0xFFFA, 0xFFFB),
}
hits = {}
for name, cps in invisible_ranges.items():
    found = []
    for i, ch in enumerate(text):
        if ord(ch) in cps:
            # 定位行号
            lineno = text.count("\n", 0, i) + 1
            found.append({"pos": i, "line": lineno, "cp": f"U+{ord(ch):04X}",
                          "name": unicodedata.name(ch, "?")})
    if found:
        hits[name] = found
report["invisible_characters"] = hits if hits else "NONE"

# ---------- 5: 同形字检测 ----------
# 拉丁文本中出现西里尔/希腊字母即可疑
homoglyphs = []
for i, ch in enumerate(text):
    cp = ord(ch)
    if 0x0400 <= cp <= 0x04FF or 0x0370 <= cp <= 0x03FF:
        lineno = text.count("\n", 0, i) + 1
        ctx = text[max(0, i-40):i+40].replace("\n", "\\n")
        homoglyphs.append({"cp": f"U+{cp:04X}", "char": ch,
                           "line": lineno, "context": ctx})
report["cyrillic_greek_homoglyphs"] = homoglyphs if homoglyphs else "NONE"

# ---------- 6: ANSI 转义序列 ----------
ansi = [{"line": text.count("\n", 0, m.start())+1, "seq": m.group(0)[:60]}
        for m in re.finditer(r"\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])", text)]
report["ansi_escape_sequences"] = ansi if ansi else "NONE"

# ---------- 7: 长编码块 ----------
b64 = [{"line": text.count("\n", 0, m.start())+1, "len": len(m.group(0)),
        "head": m.group(0)[:50]}
       for m in re.finditer(r"[A-Za-z0-9+/]{40,}={0,2}", text)]
hexb = [{"line": text.count("\n", 0, m.start())+1, "len": len(m.group(0)),
         "head": m.group(0)[:50]}
        for m in re.finditer(r"(?:[0-9a-fA-F]{2}){20,}", text)]
report["long_base64_runs"] = b64 if b64 else "NONE"
report["long_hex_runs"] = hexb if hexb else "NONE"

# ---------- 8: URL 与 Markdown 链接 ----------
urls = sorted(set(re.findall(r"https?://[^\s\)\"'>]+", text)))
md_links = re.findall(r"\[([^\]]{1,80})\]\(([^)]+)\)", text)
report["urls"] = urls if urls else "NONE"
report["markdown_links"] = md_links if md_links else "NONE"
# 链接文字与目标不一致(诱骗链接)
mismatch = [{"text": t, "target": u} for t, u in md_links
            if u.startswith("http") and t.lower() not in u.lower()]
report["link_text_target_mismatch"] = mismatch if mismatch else "NONE"

# ---------- 9: 注入/危险命令关键词 ----------
patterns = {
    "ignore/disregard previous": r"(?i)\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(previous|prior|above|earlier|instructions?|prompt|rules?)\b",
    "exfiltration": r"(?i)\b(exfiltrate|upload|send|post|transmit|phone home|beacon)\b[^.\n]{0,50}\b(secret|token|key|credential|password|env|\.env|data)\b",
    "curl/wget pipe to shell": r"(?i)(curl|wget)[^\n]{0,120}(\|\s*(ba)?sh|bash|sh\s)",
    "eval/exec": r"(?i)\b(eval|exec)\s*\(",
    "rm -rf / nc / reverse shell": r"(?i)\brm\s+-rf\s+/|\bnc\s+-e|bash\s+-i\s+>&|/dev/tcp/",
    "credential file access": r"(?i)\.env\b|id_rsa|\.ssh/|\.aws/|\.netrc|\.git-?credentials",
    "api key/token harvesting": r"(?i)\b(api[_-]?key|secret[_-]?key|access[_-]?token|ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b",
    "disable safety": r"(?i)\b(disable|bypass|turn\s+off)\b[^.\n]{0,30}\b(safety|guard|filter|sandbox|security)\b",
    "sudo/root escalation": r"(?i)\b(sudo|chmod\s+777|setuid)\b",
    "hidden network target": r"(?i)\b(webhook|pastebin|ngrok|t\.me/|discord\.com/api|raw\.githubusercontent)\b",
    "base64 decode+exec": r"(?i)(base64|atob|fromhex)[^\n]{0,40}(decode|exec|eval|-d\s)",
    "self-replicate": r"(?i)(replicate|copy\s+itself|spread\s+to)\b",
}
kw_hits = {}
for name, pat in patterns.items():
    ms = [{"line": text.count("\n", 0, m.start())+1, "match": m.group(0)[:100]}
          for m in re.finditer(pat, text)]
    if ms:
        kw_hits[name] = ms
report["injection_keyword_hits"] = kw_hits if kw_hits else "NONE"

# ---------- 10: 逐节熵 ----------
sections = []
cur_title, cur_start = "(header)", 0
for idx, line in enumerate(lines):
    if re.match(r"^#{1,3}\s", line):
        if cur_title != "(header)" or idx > 0:
            sections.append((cur_title, cur_start, idx))
        cur_title, cur_start = line.strip(), idx
sections.append((cur_title, cur_start, len(lines)))

def entropy(s):
    if not s: return 0.0
    c = Counter(s)
    n = len(s)
    return -sum((v/n)*math.log2(v/n) for v in c.values())

sec_entropy = []
for title, s, e in sections:
    body = "\n".join(lines[s:e])
    # 仅对字母数字计算，排除markdown结构符号的干扰
    alnum = re.sub(r"[^A-Za-z0-9]", "", body)
    sec_entropy.append({"section": title[:60], "lines": f"{s+1}-{e}",
                        "chars": len(body), "entropy": round(entropy(alnum), 3)})
report["per_section_entropy"] = sec_entropy

# ---------- 11: 非 ASCII 码点清单 ----------
non_ascii = Counter(f"U+{ord(c):04X} {c!r} {unicodedata.name(c, '?')}"
                    for c in text if ord(c) > 127)
report["non_ascii_codepoints"] = dict(non_ascii) if non_ascii else "NONE (纯ASCII)"

# ---------- 附加: 控制字符 C0/C1 ----------
ctrl = [{"cp": f"U+{ord(c):04X}", "line": text.count("\n", 0, i)+1}
        for i, c in enumerate(text) if ord(c) < 32 and c not in "\n\t" or 0x7F == ord(c)]
report["control_characters"] = ctrl if ctrl else "NONE"

import os
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=2)

# 摘要打印
print("="*70)
print("取证扫描摘要")
print("="*70)
print(f"文件: {report['size_bytes']} bytes, {report['line_count']} 行, sha256={report['sha256'][:16]}...")
print(f"BOM: {report['bom']}, CRLF: {report['crlf']}, 独立CR: {report['lone_cr']}")
print(f"隐形字符: {report['invisible_characters']}")
print(f"同形字: {report['cyrillic_greek_homoglyphs']}")
print(f"ANSI转义: {report['ansi_escape_sequences']}")
print(f"Base64长块: {report['long_base64_runs']}")
print(f"Hex长块: {report['long_hex_runs']}")
print(f"URL: {report['urls']}")
print(f"MD链接: {report['markdown_links']}")
print(f"链接诱骗: {report['link_text_target_mismatch']}")
print(f"注入关键词命中: {json.dumps(report['injection_keyword_hits'], ensure_ascii=False, indent=2)}")
print(f"非ASCII码点: {report['non_ascii_codepoints']}")
print(f"控制字符: {report['control_characters']}")
print("\n逐节熵:")
for s in sec_entropy:
    print(f"  {s['entropy']:>6}  {s['lines']:>9}  {s['section']}")
