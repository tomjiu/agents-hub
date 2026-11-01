#!/usr/bin/env python3
# analyze_domain.py — 全领域评测汇总: 域表 + 车道贡献矩阵 + 零贡献名单 + 可疑行 refs 抽查
import json, collections, itertools, sys

RES = "/tmp/eval-domain/results.jsonl"
rows = [json.loads(l) for l in open(RES) if l.strip()]
print(f"== 加载 {len(rows)} 题 ==")

# domain -> apiProviders (拷贝自 planner.go domainTable, 2026-09 状态)
DOM = {
 "packages":["npm","crates","packagist","rubygems","pypi","metacpan","repology","nuget","hex","pubdev"],
 "devops":["dockerhub","flathub","arch","artifacthub","snapcraft","endoflife"],
 "programming":["stackexchange","github","hn","keenable","mdn"],
 "academic":["arxiv","crossref","openalex","dblp","pubmed","wikipedia","hfpapers","zenodo","doaj","openaire","inspirehep","openreview"],
 "ai-models":["huggingface"],
 "entities":["wikidata"],
 "quakes":["usgsquakes"],
 "geo":["nominatim","wikidata"],
 "images":["openverse","commonswiki","nasaimages"],
 "security":["nvd","osv","ghsa"],
 "news":["googlenews","bingnews"],
 "lyrics":["lrclib"],
 "dictionary":["wiktionary"],
 "chemistry":["pubchem"],
 "medical":["europepmc","clinicaltrials"],
 "data":["worldbank"],
 "weather":["openmeteo"],
 "music":["musicbrainz"],
 "space":["thespacedevs"],
 "browser-ext":["mozaddons"],
 "tv":["tvmaze"],
 "podcast":["itunes"],
 "games":["steam"],
 "species":["gbif","uniprot","inaturalist"],
 "legal":["federalregister","courtlistener"],
 "drug":["openfda"],
 "finance":["coingecko","frankfurter"],
 "food":["themealdb","openfoodfacts"],
 "manga":["mangadex"],
 "anime":["kitsu"],
 "sport":["thesportsdb"],
 "books":["standardebooks"],
 "drinks":["thecocktaildb"],
 "travel":["wikivoyage"],
 "ide-ext":["openvsx","jetbrains"],
 "wordpress":["wpplugins"],
}
API_LANES = set(l for ps in DOM.values() for l in ps)

# ---------- 域表 ----------
print("\n===== 域表 (按命中排序) =====")
dom_stats = []
_groups = collections.defaultdict(list)
for r in rows: _groups[r["domain"]].append(r)
for dom, qs in _groups.items():
    qs = list(qs)
    n = len(qs)
    hits = sum(1 for r in qs if r.get("hit"))
    refs = [r.get("nRefs", 0) for r in qs]
    ud = [r.get("uniqDom", 0) for r in qs if r.get("uniqDom") is not None]
    wall = [r.get("wallMs", 0) for r in qs]
    provs_ok, provs_fail, provs_never = set(), set(), set()
    for r in qs:
        used, failed = set(r.get("enginesUsed", [])), set(r.get("enginesFailed", []))
        provs_ok |= used & set(DOM[dom])
        provs_fail |= failed & set(DOM[dom])
    provs_never = set(DOM[dom]) - provs_ok - provs_fail
    dom_stats.append((dom, n, hits, refs, ud, wall, provs_ok, provs_fail, provs_never))

for dom, n, hits, refs, ud, wall, pok, pfail, pnever in sorted(dom_stats, key=lambda x: -(x[2]/x[1] if x[1] else -1)):
    avg_r = sum(refs)/n; avg_ud = sum(ud)/len(ud) if ud else 0; avg_w = sum(wall)/n
    flag = "  ←← 空洞" if hits == 0 else ("  ← 薄" if avg_r < 4 else "")
    print(f"{dom:12s} {hits}/{n} hit  avgRefs={avg_r:4.1f} avgUD={avg_ud:4.1f} avg={avg_w/1000:5.1f}s  "
          f"providerOK={sorted(pok) or '-'} provFail={sorted(pfail) or '-'} neverRan={sorted(pnever) or '-'}{flag}")

# ---------- 车道贡献矩阵 ----------
print("\n===== 车道贡献矩阵 (API 车道) =====")
lane = collections.defaultdict(lambda: {"ran": 0, "fail": 0, "contrib": 0, "refs": 0})
for r in rows:
    for l in r.get("enginesUsed", []):
        if l in API_LANES: lane[l]["ran"] += 1
    for l in r.get("enginesFailed", []):
        if l in API_LANES: lane[l]["fail"] += 1
    contributed = set()
    for ref in r.get("refs", []):
        for l in ref.get("engines", []):
            contributed.add(l)
    for l in contributed:
        if l in API_LANES:
            lane[l]["contrib"] += 1
            lane[l]["refs"] += sum(1 for ref in r.get("refs", []) if l in ref.get("engines", []))

zero, weak, healthy = [], [], []
for l, s in sorted(lane.items(), key=lambda x: x[1]["contrib"]):
    rate = s["contrib"] / s["ran"] if s["ran"] else 0
    tag = "ZERO" if (s["ran"] + s["fail"] >= 2 and s["contrib"] == 0) else ("weak" if rate < 0.25 else "ok")
    print(f"{l:15s} ran={s['ran']:2d} fail={s['fail']:2d} contrib={s['contrib']:2d} refs={s['refs']:2d} rate={rate:4.2f} {tag}")
    if tag == "ZERO": zero.append(l)
    elif tag == "weak": weak.append(l)
    else: healthy.append(l)
print(f"\nZERO 车道({len(zero)}): {zero}")
print(f"weak 车道({len(weak)}): {weak}")
print(f"ok 车道({len(healthy)}): {healthy}")

# 通用引擎车道贡献
gen = collections.defaultdict(int)
for r in rows:
    for ref in r.get("refs", []):
        for l in ref.get("engines", []):
            if l not in API_LANES: gen[l] += 1
print(f"\n通用引擎贡献 refs 次数: {dict(sorted(gen.items(), key=lambda x: -x[1]))}")

# ---------- 可疑行 refs 抽查 (expect 误判 vs 真空洞) ----------
print("\n===== 可疑行抽查 (MISS 但 refs>0) =====")
for r in rows:
    if not r.get("hit") and r.get("nRefs", 0) > 0:
        print(f"\n[{r['domain']}] {r['q']}  expect={r['expect']}")
        for ref in r["refs"][:3]:
            print(f"   ({','.join(ref['engines']) or '?'}) {ref['title'][:90]}")
