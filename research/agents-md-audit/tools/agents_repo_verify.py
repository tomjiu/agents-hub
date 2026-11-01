#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""验证 AGENTS-EN.md §6 引用的7个外部GitHub仓库的身份/活跃度/许可证/供应链风险"""
import json, urllib.request, urllib.error, ssl
import os
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.normpath(os.path.join(_HERE, ".."))

REPOS = [
    "vercel-labs/open-agents",
    "divyanshu-iitian/agent-website-design-skills",
    "thekorn/agent-skills",
    "PracticalSwan/agent-skills",
    "mblode/agent-skills",
    "overseek944/frontend-ui-ux-skill",
    "MengTo/Skills",
]
OUT = os.path.join(_ROOT, "evidence", "external-repos.json")
UA = {"User-Agent": "supply-chain-audit-script", "Accept": "application/vnd.github+json"}

results = []
for repo in REPOS:
    entry = {"repo": repo, "api": f"https://api.github.com/repos/{repo}"}
    try:
        req = urllib.request.Request(entry["api"], headers=UA)
        with urllib.request.urlopen(req, timeout=15) as r:
            d = json.load(r)
        entry.update({
            "exists": True,
            "description": d.get("description"),
            "stars": d.get("stargazers_count"),
            "forks": d.get("forks_count"),
            "created": d.get("created_at", "")[:10],
            "pushed_at": (d.get("pushed_at") or "")[:10],
            "language": d.get("language"),
            "license": (d.get("license") or {}).get("spdx_id"),
            "topics": d.get("topics", []),
            "archived": d.get("archived"),
            "open_issues": d.get("open_issues_count"),
            "default_branch": d.get("default_branch"),
        })
        # 取最近一次提交信息(判断是否活跃维护/是否可疑)
        try:
            creq = urllib.request.Request(
                f"https://api.github.com/repos/{repo}/commits?per_page=1", headers=UA)
            with urllib.request.urlopen(creq, timeout=15) as r:
                c = json.load(r)
            if c:
                entry["last_commit"] = {
                    "date": c[0]["commit"]["committer"]["date"][:10],
                    "message": c[0]["commit"]["message"][:80],
                    "author_login": (c[0].get("author") or {}).get("login"),
                }
        except Exception as e:
            entry["last_commit_error"] = str(e)[:100]
    except urllib.error.HTTPError as e:
        entry.update({"exists": False, "http_status": e.code, "note": "404=仓库不存在/已删除/私有"})
    except Exception as e:
        entry.update({"exists": None, "error": str(e)[:200]})
    results.append(entry)

import os
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

for e in results:
    if e.get("exists") is True:
        print(f"✓ {e['repo']}")
        print(f"    {e['stars']}★ {e['forks']}forks | 创建{e['created']} 最后推送{e['pushed_at']} | {e['license']} | 语言{e['language']}")
        print(f"    描述: {e['description']}")
        if e.get("last_commit"):
            print(f"    最近提交: {e['last_commit']['date']} - {e['last_commit']['message']}")
    elif e.get("exists") is False:
        print(f"✗ {e['repo']}  HTTP {e['http_status']}  {e.get('note','')}")
    else:
        print(f"? {e['repo']}  错误: {e.get('error')}")
