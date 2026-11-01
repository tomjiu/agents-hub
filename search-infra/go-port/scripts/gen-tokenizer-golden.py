#!/usr/bin/env python3
# gen-tokenizer-golden.py — 批 27: 生成 Go BERT tokenizer 的 golden 对拍文件
# 输出 testdata/tokenizer-golden.json: [{q, d, ids, typeIds, mask}]
# 覆盖: 标点/数字/大小写混合/CJK/URL/长 doc 截断(512)
import json, sys
from tokenizers import Tokenizer

tok = Tokenizer.from_file("/home/z/my-project/.cache/ce-model/tokenizer.json")
# 与产品重排一致: pair 联合 512 截断 (长 doc 在 Go 侧同规则截断)
tok.enable_truncation(max_length=512, strategy="longest_first")

CASES = [
    ("who wrote the song always be humble and kind", "songwriter Lori McKenna wrote Humble and Kind (2016), a country song for Tim McGraw."),
    ("what is the maximum data rate for the 802.11a standard?", "IEEE 802.11a-1999 uses a 52-subcarrier OFDM at 5 GHz band, max 54 Mbit/s."),
    ("WHO DID MICHIGAN STATE Play in the Rose Bowl", "Michigan State Spartans vs. Stanford Cardinal — 2014 Rose Bowl Game (24-20)."),
    ("e=mc^2 means what?", "Mass-energy equivalence: E = mc2, derived by Albert Einstein in 1905 (Annus Mirabilis)."),
    ("美国的首都是什么", "Washington, D.C. 是美利坚合众国的首都，位于东海岸。Population about 700,000."),
    ("hello   world\twith\ttabs", "Multiple    spaces   and\ttabs collapse to single space in BERT basic tokenizer."),
    ("café naïve résumé", "Accented chars: café, naïve, résumé — wordpiece may map to UNK without accent stripping."),
    ("3.14159 and 42,000 + 7", "Numbers with punctuation: 3.14159, 42,000, and +7 are split at punctuation boundaries."),
    ("don't stop believin'", "Contractions split: don't -> don + ' + t in BERT wordpiece pre-tokenization."),
    ("C++ vs C# programming", "Symbols like $ + < > = | ~ are treated as punctuation separators in BertPreTokenizer."),
    ("who played tibbs", "In the Heat of the Night (TV series) starred Howard E. Rollins Jr. as Detective Virgil Tibbs (CBS 1992-1995)."),
    ("a very long document test", "The Leaning Tower of Pisa " * 60),  # 触发 512 截断
]

out = []
for q, d in CASES:
    enc = tok.encode(q, d)
    out.append({"q": q, "d": d, "ids": enc.ids, "typeIds": enc.type_ids, "mask": enc.attention_mask})

path = sys.argv[1] if len(sys.argv) > 1 else "testdata/tokenizer-golden.json"
with open(path, "w") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print(f"golden: {len(out)} cases -> {path}")
for c in out[:3]:
    print(f"  len={len(c['ids'])} ids[:8]={c['ids'][:8]}")
