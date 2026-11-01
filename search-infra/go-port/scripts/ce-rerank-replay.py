#!/usr/bin/env python3
# ce-rerank-replay.py — 批 26: cross-encoder 离线重放 (神经重排挂账的最终裁决实验)
# 数据: b25 窗 dump (NQ 98 + TQA 100, refs top-20, 注入前引擎层) — 零上游查询成本
# 模型: Xenova/ms-marco-MiniLM-L-6-v2 ONNX quantized (~22MB, CPU)
# 变体:
#   base   — dump 原序 (线上融合序还原)
#   cross  — 纯 cross-encoder 重排 (cs 降序, tie-break 原 rank)
#   rrf    — RRF 融合 (融合 rank 与 cross rank, K=60)
#   lin-λ  — score*10 + λ·cs 线性增量 (b20 增量式方法论, λ∈{1,2,4})
# 池: pool10 (与 eval topn=10 同口径) 主线; pool20 重排取前 10 为副线 (池深红利)
# 判定: verbatim + tokenAND 与 eval-external.mjs 逐字一致
# 输出: stdout 汇总 + /tmp/eval-rerank/ce-replay-review.txt (救回/损伤渲染)
import json, math, re, sys, time
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

MODEL_DIR = "/home/z/my-project/.cache/ce-model"
NQ = "/tmp/eval-rerank/nq-dump.jsonl"
TQA = "/tmp/eval-rerank/triviaqa-dump.jsonl"
REVIEW_PATH = "/tmp/eval-rerank/ce-replay-review.txt"

STOP = {"one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
        "season", "seasons", "episode", "episodes", "the", "and", "was", "were", "has", "have", "had"}

def matchEvidence(hay, answers):
    for a in answers:
        al = a.lower()
        if len(al) > 1 and al in hay:
            return True
    for a in answers:
        toks = [t for t in re.split(r"[^a-z0-9]+", a.lower()) if t and ((len(t) >= 4 and t not in STOP) or t.isdigit())]
        if not toks:
            continue
        if all(t in hay for t in toks):
            return True
    return False

def scoreBatch(sess, tok, q, docs):
    """docs: list of text. 返回 logits 列表. 单批打包."""
    encs = tok.encode_batch([(q, d[:1500]) for d in docs])
    maxlen = max(len(e.ids) for e in encs)
    n = len(encs)
    ids = np.zeros((n, maxlen), dtype=np.int64)
    am = np.zeros((n, maxlen), dtype=np.int64)
    tt = np.zeros((n, maxlen), dtype=np.int64)
    for i, e in enumerate(encs):
        L = len(e.ids)
        ids[i, :L] = e.ids; am[i, :L] = e.attention_mask; tt[i, :L] = e.type_ids
    out = sess.run(None, {"input_ids": ids, "attention_mask": am, "token_type_ids": tt})
    return out[0].ravel().tolist()

def rrf_merge(rank_a, rank_b, K=60):
    # rank_x: 该 ref 在对应序中的名次 (1-based)
    return 1.0 / (K + rank_a) + 1.0 / (K + rank_b)

def replay(rows, sess, tok, label, review):
    n = len(rows)
    wall_total = 0.0
    enriched = []
    for row in rows:
        refs = row["refs"][:20]
        if not refs:
            continue
        docs = [f"{r['title']}\n{r['snippet']}" for r in refs]
        t0 = time.time()
        cs = scoreBatch(sess, tok, row["q"], docs[:10])  # 主线池 top-10
        wall_total += (time.time() - t0)
        # pool20 副线: 全 20 refs 一次打分
        cs20 = scoreBatch(sess, tok, row["q"], docs) if len(docs) > 10 else cs
        # base 序 (dump rank 序) 的证据位
        hays = [f"{r['title']}\n{r['snippet']}".lower() for r in refs]
        baseHit = next((i + 1 for i, h in enumerate(hays) if matchEvidence(h, row["answers"])), 0)
        enriched.append({**row, "refs": refs, "cs10": cs, "cs20": cs20, "baseHit": baseHit})

    # 变体 → 新序 (每个变体重算证据位)
    def orderOf(e, variant, pool):
        refs = e["refs"][:pool]
        cs = e["cs10"] if pool == 10 else e["cs20"]
        if variant == "base":
            return list(range(len(refs)))
        if variant == "cross":
            key = [(-cs[i], i) for i in range(len(refs))]
        elif variant == "rrf":
            key = [-rrf_merge(i + 1, cs.index(sorted(cs, reverse=True)[i]) + 1) for i in range(len(refs))] if False else None
            # rrf: 对每个 i, 融合名次=i+1, cross 名次=cs 降序中的位次
            order_cs = sorted(range(len(refs)), key=lambda i: -cs[i])
            cross_rank = {oi: r + 1 for r, oi in enumerate(order_cs)}
            return sorted(range(len(refs)), key=lambda i: -rrf_merge(i + 1, cross_rank[i]))
        elif variant.startswith("lin"):
            lam = float(variant.split("-")[1])
            key = [(-(e["refs"][i].get("score", 0) * 10 + lam * cs[i]), i) for i in range(len(refs))]
        if variant == "cross" or variant.startswith("lin"):
            return [i for _, i in sorted(key)]
        return list(range(len(refs)))

    variants = ["base", "cross", "rrf", "lin-1", "lin-2", "lin-4"]
    res = {v: {"h1": 0, "h3": 0} for v in variants}
    res20 = {v: {"h1": 0, "h3": 0} for v in variants}
    posKeep = []   # baseHit 2..10 (位次保持池)
    for e in enriched:
        if 2 <= e["baseHit"] <= 10:
            posKeep.append(e)
        for v in variants:
            for pool, acc in ((10, res), (20, res20)):
                order = orderOf(e, v, pool)
                refs = e["refs"][:pool]
                hit = next((i + 1 for i, oi in enumerate(order) if matchEvidence(haysOf(refs)[oi], e["answers"])), 0)
                if hit == 1: acc[v]["h1"] += 1
                if hit and hit <= 3: acc[v]["h3"] += 1

    print(f"\n==== {label}: n={len(enriched)} (位次保持池 {len(posKeep)}) ====")
    print(f"{'variant':<8} {'pool':<5} {'hit@1':<12} {'hit@3':<12}")
    for pool, table, tag in ((10, res, "p10"), (20, res20, "p20")):
        for v in variants:
            r = table[v]
            print(f"{v:<8} {tag:<5} {str(r['h1']).rjust(3)}/{len(enriched)} ({100*r['h1']/len(enriched):5.1f}%) {str(r['h3']).rjust(3)}/{len(enriched)} ({100*r['h3']/len(enriched):5.1f}%)")
    print(f"cross top-10 打分均摊: {1000*wall_total/len(enriched):.1f}ms/题 (batch)")

    # 渲染: 位次保持池在 cross-p10 下的救回/损伤
    review.write(f"\n######## {label} — 位次保持池 {len(posKeep)} 题 cross(p10) 救回/损伤 ########\n")
    saved = hurt = 0
    for e in posKeep:
        order = orderOf(e, "cross", 10)
        refs = e["refs"][:10]
        hit = next((i + 1 for i, oi in enumerate(order) if matchEvidence(haysOf(refs)[oi], e["answers"])), 0)
        tag = "救回" if hit == 1 else ("保持" if hit else "掉出")
        if hit == 1: saved += 1
        if hit == 0: hurt += 1
        if hit == 1 or hit == 0:
            g = e["refs"][e["baseHit"] - 1]
            review.write(f"\n[{tag}] Q: {e['q']}\n  base: gold@{e['baseHit']} | cross: {'hit@'+str(hit) if hit else 'miss'}\n")
            review.write(f"  base-rank1: {refs[0]['title'][:100]}\n    snip: {refs[0]['snippet'][:150].replace(chr(10), ' ')}\n")
            review.write(f"  gold页: {g['title'][:100]}\n    snip: {g['snippet'][:150].replace(chr(10), ' ')}\n")
    print(f"位次保持池 cross(p10): 救回@1 {saved}/{len(posKeep)}, 保持位 {len(posKeep)-saved-hurt}, 掉出 {hurt}")

    # flip 渲染: baseHit==1 的题在 cross(p10) 下的去向 (损伤面定性)
    review.write(f"\n######## {label} — base@1 flip (cross p10) ########\n")
    flips = []
    for e in enriched:
        if e["baseHit"] != 1:
            continue
        order = orderOf(e, "cross", 10)
        refs = e["refs"][:10]
        hit = next((i + 1 for i, oi in enumerate(order) if matchEvidence(haysOf(refs)[oi], e["answers"])), 0)
        if hit != 1:
            flips.append((e, hit, refs[order[0]]))  # 新@1 一并捕获, 防 for 变量泄漏
    print(f"base@1 flip: {len(flips)} 题跌出 rank1 (cross p10)")
    for e, hit, new1 in flips:
        review.write(f"\n[flip→{hit if hit else 'miss'}] Q: {e['q']}\n")
        review.write(f"  原@1: {e['refs'][0]['title'][:100]}\n    snip: {e['refs'][0]['snippet'][:150].replace(chr(10), ' ')}\n")
        review.write(f"  新@1: {new1['title'][:100]}\n    snip: {new1['snippet'][:150].replace(chr(10), ' ')}\n")
    return {"n": len(enriched), "res": res, "res20": res20, "posKeep": len(posKeep), "saved": saved, "hurt": hurt, "flip": len(flips), "wallMs": 1000*wall_total/len(enriched)}

def haysOf(refs):
    return [f"{r['title']}\n{r['snippet']}".lower() for r in refs]

def main():
    tok = Tokenizer.from_file(f"{MODEL_DIR}/tokenizer.json")
    so = ort.SessionOptions()
    sess = ort.InferenceSession(f"{MODEL_DIR}/model_quantized.onnx", so, providers=["CPUExecutionProvider"])
    review = open(REVIEW_PATH, "w")
    out = {}
    for label, path in (("NQ-open", NQ), ("TriviaQA", TQA)):
        rows = [json.loads(l) for l in open(path) if l.strip()]
        out[label] = replay(rows, sess, tok, label, review)
    # 合并
    print("\n==== 合并 (n=%d) ====" % (out["NQ-open"]["n"] + out["TriviaQA"]["n"]))
    N = out["NQ-open"]["n"] + out["TriviaQA"]["n"]
    for pool, key in (("p10", "res"), ("p20", "res20")):
        for v in ["base", "cross", "rrf", "lin-1", "lin-2", "lin-4"]:
            h1 = out["NQ-open"][key][v]["h1"] + out["TriviaQA"][key][v]["h1"]
            h3 = out["NQ-open"][key][v]["h3"] + out["TriviaQA"][key][v]["h3"]
            print(f"{v:<8} {pool:<5} hit@1 {h1}/{N} ({100*h1/N:5.1f}%)  hit@3 {h3}/{N} ({100*h3/N:5.1f}%)")
    saved = out["NQ-open"]["saved"] + out["TriviaQA"]["saved"]
    hurt = out["NQ-open"]["hurt"] + out["TriviaQA"]["hurt"]
    pk = out["NQ-open"]["posKeep"] + out["TriviaQA"]["posKeep"]
    print(f"位次保持池合计: {pk}, cross 救回 {saved}, 掉出 {hurt}; 打分均摊 {out['NQ-open']['wallMs']:.0f}/{out['TriviaQA']['wallMs']:.0f}ms/题")
    review.close()
    print(f"\n复核文件: {REVIEW_PATH}")

if __name__ == "__main__":
    main()
