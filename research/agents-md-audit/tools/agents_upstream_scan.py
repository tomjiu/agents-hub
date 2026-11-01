#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""扫描7个上游技能仓库的内容: SKILL清单 + 注入模式 + 网络端点 + 危险命令"""
import json, os, re, subprocess
import os
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.normpath(os.path.join(_HERE, ".."))
from collections import OrderedDict

BASE = os.path.join(_ROOT, "_upstream")
OUT = os.path.join(_ROOT, "evidence", "upstream-scan.json")

REPOS = [d for d in os.listdir(BASE) if os.path.isdir(os.path.join(BASE, d))]

INJECTION_PATTERNS = {
    "override/ignore instructions": r"(?i)\b(ignore|disregard|override|forget)\b[^.\n]{0,40}\b(previous|prior|above|system|developer|user)\b[^.\n]{0,20}\b(instruction|prompt|rule|message|directive)s?\b",
    "exfiltrate secrets": r"(?i)\b(send|post|upload|exfiltrate|transmit|webhook)\b[^.\n]{0,60}\b(secrets?|tokens?|credentials?|passwords?|api[_-]?keys?|\.env)\b",
    "curl/wget pipe shell": r"(?i)\b(curl|wget)\b[^\n]{0,150}(\|\s*(ba|z|fi)?sh\b|>\s*/dev/shm/)",
    "eval/exec payload": r"(?i)\b(eval|exec)\s*[\"'(\s]\s*[\"'][A-Za-z0-9+/=]{30,}",
    "base64 decode exec": r"(?i)\b(base64\s+(-d|--decode)|atob)\b[^\n]{0,60}(\|\s*(ba)?sh|eval|exec)",
    "reverse shell": r"(?i)(bash\s+-i\s+>&\s*/dev/tcp|nc\s+-e\s+/bin/(ba)?sh|socat[^\n]{0,30}pty)",
    "credential file read": r"(?i)\b(id_rsa|\.git-?credentials|\.netrc|\.aws/credentials)\b",
    "token literal": r"\b(ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[bpars]-[A-Za-z0-9-]{10,})\b",
    "disable safety": r"(?i)\b(disable|bypass)\b[^.\n]{0,30}\b(safety|guardrail|sandbox|security|protection|filter)\b",
    "hidden network": r"(?i)\b(webhook\.site|pastebin\.com/raw|ngrok\.io|trycloudflare|t\.me/|discord(app)?\.com/api/webhooks)\b",
}

def git_log(d, n=3):
    try:
        out = subprocess.run(["git", "-C", d, "log", "--oneline", f"-{n}"],
                             capture_output=True, text=True, timeout=10).stdout
        return out.strip().splitlines()
    except Exception:
        return []

report = {}
for repo in sorted(REPOS):
    d = os.path.join(BASE, repo)
    info = OrderedDict()
    info["git_head"] = subprocess.run(["git", "-C", d, "rev-parse", "HEAD"],
                                      capture_output=True, text=True).stdout.strip()
    info["recent_commits"] = git_log(d)
    info["last_commit_date"] = subprocess.run(
        ["git", "-C", d, "log", "-1", "--format=%ci"], capture_output=True, text=True).stdout.strip()

    # 文件统计
    all_files = []
    SKIP_DIRS = {"node_modules", "dist", "build", ".venv", "venv", "__pycache__", "target", ".next", "vendor", "assets/fonts", "fonts"}
    for root, dirs, files in os.walk(d):
        dirs[:] = [x for x in dirs if x != ".git" and x not in SKIP_DIRS and not x.endswith(".woff2")]
        for f in files:
            fp = os.path.join(root, f)
            try:
                if os.path.getsize(fp) <= 1_500_000:
                    all_files.append(fp)
            except OSError:
                pass
        if len(all_files) > 4000:
            break
    info["file_count"] = len(all_files)
    info["file_count_capped"] = len(all_files) >= 4000
    skills = [f for f in all_files if os.path.basename(f).upper() in ("SKILL.MD", "SKILL.TXT")]

    # 读取所有文本文件做注入扫描
    text_ext = (".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".sh", ".py", ".js", ".ts", ".mjs", ".html")
    hits = {}
    network_endpoints = set()
    scanned = 0
    for f in all_files:
        if not f.endswith(text_ext):
            continue
        scanned += 1
        if scanned > 1500:
            break
        try:
            content = open(f, encoding="utf-8", errors="ignore").read()
        except Exception:
            continue
        rel = os.path.relpath(f, d)
        for name, pat in INJECTION_PATTERNS.items():
            for m in re.finditer(pat, content):
                hits.setdefault(name, []).append(
                    {"file": rel, "line": content.count("\n", 0, m.start())+1,
                     "match": m.group(0)[:120]})
        for m in re.finditer(r"https?://([A-Za-z0-9.-]+)", content):
            host = m.group(1).lower()
            if not re.match(r"^(www\.)?(example|localhost|127\.0\.0\.1|schema|w3\.org|json-schema|your-|placeholder)", host):
                network_endpoints.add(host)

    info["skill_md_count"] = len(skills)
    info["skill_md_files"] = [os.path.relpath(s, d) for s in skills[:40]]
    info["text_files_scanned"] = scanned
    info["injection_hits"] = hits if hits else "NONE"
    info["network_hosts"] = sorted(network_endpoints)[:60]
    report[repo] = info

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=2)

# 摘要
for repo, info in report.items():
    print(f"=== {repo}")
    print(f"    HEAD={info['git_head'][:10]} 最后提交={info['last_commit_date'][:10]} 文件数={info['file_count']} SKILL.md数={info['skill_md_count']}")
    for c in info["recent_commits"]:
        print(f"    commit: {c}")
    inj = info["injection_hits"]
    if inj == "NONE":
        print("    注入扫描: 无命中")
    else:
        print(f"    ⚠ 注入扫描命中: {list(inj.keys())}")
        for k, v in inj.items():
            for h in v[:3]:
                print(f"      [{k}] {h['file']}:{h['line']} -> {h['match'][:80]}")
    print(f"    网络端点({len(info['network_hosts'])}): {', '.join(info['network_hosts'][:12])}{'...' if len(info['network_hosts'])>12 else ''}")
