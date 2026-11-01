# D · 新兴 AI 搜索成品扫描（0-300 星新苗层）

> 任务 9-a 产出。扫描日期：**2026-09-02**。
> 补位说明：任务 7-a 扫的是 stars≥50 的"成名仓库"，这轮专门捞**反方向**——0~300 星、2025 年后创建、近 3 个月（pushed > 2026-06-01）还活跃的新项目。这类"个人 + AI 写的"新仓库发布初期没星，但思路往往最新。
> 方法：GitHub Search API 19 个请求（认证后 30 次/分钟限额内，sort=updated 拿活跃 + sort=created 拿最新各一轮）+ commits Link header 数 commit + 逐个抽查 raw README + git trees 数文件验真。
> 硬门槛：**commit ≥ 5 且 pushed > 2026-06-01 且非 fork**；再人工过滤掉教程/课程作业/纯壳/挂羊头卖狗肉的。

---

## 一、30 秒结论（大白话）

1. **这一层质量比想象中高得多**。上轮（7-a）结论是"star 多不等于活得久"；这轮反过来——**星少不等于做得浅**。挖出了一批 0~10 星但 100~1000+ commits 的硬货：deepr（10★/1067 commits）、Polaris（1★/347）、OpenSaC（2★/154）、argo（115★/163）、openJiuwen deepsearch（119★/324）。星数在这个层面基本失效，commit 数 + 目录结构才是真信号。
2. **主流"Perplexity 皮"已经卷成红海，新苗都在卷"答案的可信性"**：有人在把**分歧**摆上桌（gainsay/passiveworkers 拒绝强行合成一个答案）、有人在让答案**能被申诉**（gainsay 还写了份 CONSTITUTION.md 当产品宪法）、有人在用 CI **测试"我说不知道"这件事本身**（lukefwalton/answer-engine、ultrasearch 的 check 命令直接 fail 掉无引用的断言）。
3. **"搜索即代码"出现了第一个认真实现**：OpenSaC 把 Perplexity 今年公开的 Search-as-Code 抽象做成了沙箱运行时——agent 不再发一串固定 tool-call，而是**写一个 Python 程序**（批量查、join、过滤、融合、打印带来源的结果）扔进 Docker 沙箱跑。这是对"固定 tool-call 循环"范式的正面挑战，对我们 search-core 的 fusion/research loop 是最值得盯的一条线。
4. **反爬军备已经从"基建问题"变成"agent 工具"**：deepcloak（60★）直接把 Cloudflare/Datadom/Turnstile/reCAPTCHA 穿越做成了 PyPI 包 + MCP server，卖点就一句"读别人读不了的页面"。这跟我们 8-b 轮实测撞到的协议指纹墙（DDG JA3 封 202、Wikimedia 拒 h1）是同一件事的另一半。
5. **SearXNG 仍是新苗层的第一引擎**（Wisp/Polaris/webharvest/js-deepresearch/kala-mcp 全踩它），但 Polaris 踩出了一个我们没记录过的坑：**自托管 SearXNG 被限流/验证码时静默返回空结果而不是报错**——"全空 ≠ 无结果，全空 = 故障"。这个失败模式检测值得直接抄进 search-core。
6. **搜索的"感知面"在往 indexed text 之外长**：omniseek（播客第 47 分钟/登录墙后/评论区深层/跨语言）、Sicry（Tor/.onion 18 个暗网引擎）、BuyWhere（3 亿商品）、Autosearch/argo（40 通道含 10+ 中文源）——"web 搜索"这个词正在被拆成"一堆各自免 key 的垂直面"。
7. **反面镜像：AEO/GEO（"被 AI 引用侧"）工具在这一层爆发**（elmo 290★、canonry 129★、ansvisor 104★、aeo.js 131★、GetCito 180★……），说明"怎么被 AI 搜索引用"已经是独立产业，但它们不是搜索引擎，本篇只记趋势不展开。

---

## 二、主表 · 💎 新苗档（0~10 星但思路独特，commit ≥ 5，全部活到 8 月底之后）

> 按"思路独特度 × 真实工程量"排。星数是次要的，这档的核心是"没人看见它，但它想清楚了"。

| full_name | stars | created | pushed | commits | license | 它是什么 | 搜索后端/思路亮点 | 对 search-core 可抄的 |
|---|---|---|---|---|---|---|---|---|
| liuqi6777/OpenSaC | 2 | 2026-08-18 | 09-02 | 154 | MIT | **搜索即代码运行时**：agent 写 Python 程序代替固定 tool-call，Docker 沙箱执行，capability broker 管特权操作 | 实现 Perplexity 官方公开的 Search-as-Code 抽象（research.perplexity.ai 那篇）；程序里可批量查询、join、过滤、融合、抽取结构化数据、持久化中间态 | ⭐⭐⭐ 把"研究循环"从预设管线升级为"生成的检索程序"；我们 fusion 是固定管线，这是范式级对照物 |
| salpenr/gainsay | 0 | 2026-06-26 | 07-20 | 8 | MIT | **把分歧摆上桌的答案引擎**："智力正当程序"——每个断言可溯源、冲突不抹平、权重可见、结论可申诉、过程可复现 | 本地跑，web+本地文档+学术源；仓库里有份 CONSTITUTION.md 当"产品宪法"绑定这些保证；代码按 lens 分模块（credibility/rerank/scholar/report） | ⭐⭐ "分歧不合成"的输出契约 + 把产品承诺写成可检查的宪法文件——与我们"失败标注契约"同族但更进一步 |
| AutumnsGrove/Polaris | 1 | 2026-07-18 | 09-02 | 347 | MIT | 自托管 Kagi Assistant 平替：单 Go 二进制内嵌 Web UI，聊天+独立搜索结果页 | 自家 SearXNG 打底（零 key），**检测 SearXNG 静默空结果（限流/验证码）→ 判定"全空=故障"→ 依次降级 Brave→Parallel→Tavily，结果全部标注 `[via X]`，宁可报"搜索降级"不给假"无结果"** | ⭐⭐⭐ 静默失败检测 + `[via provider]` 标注 + 显式降级声明——正是 v0.3 backlog 里"失败标注契约"的现成参考实现 |
| blisspixel/deepr | 10 | 2025-07-06 | 09-02 | **1067** | Apache-2.0 | **持久领域专家**：把研究变成可持续状态（信念/缺口/矛盾/置信度/出处/结果），而不是一次性报告 | CLI+MCP 双出口；研究产出"可审计的专家状态"，支持 review-gated 修订和前瞻预测；v2.50，CI 还带 mutation testing | ⭐⭐⭐ 研究结果的**持久化 schema**（belief/gap/contradiction/confidence）可直接当 research loop 的落盘格式 |
| wikithoughts/passiveworkers | 1 | 2026-06-10 | 09-02 | 93 | MIT | 多个本地 Ollama 模型当**独立分析员**各查各的，一个"盲编辑"写最终带引用报告 | **保留分析员之间的分歧，拒绝强行共识**；全本地零云；可选加入 p2p"闲置算力互助研究网络" | ⭐⭐ 多模型独立检索 + 盲编辑防锚定——比"单模型多轮反思"更抗同源幻觉；与 gainsay 是同一思想的两个工程化 |
| maxgfr/ultrasearch | 0 | 2026-06-13 | 09-02 | 142 | MIT | skills.sh 上的研究技能：免 key 多后端扇出 → 证据档案 → 两档报告（TL;DR/全文） | **`ultrasearch check` 命令：报告里有悬空引用或无来源断言就直接 fail**；检索确定性、零依赖 Node bundle；CI 里带 evals | ⭐⭐⭐ "check 不过=报告不合格"的证据校验闭环，是我们失败标注契约+evals 的合体预演 |
| Mrbaeksang/deepcloak | 60 | 2026-06-04 | 08-22 | 39 | MIT | **专读别人读不了的页面**：穿越 Cloudflare/Datadome/Turnstile/reCAPTCHA 的 deep research agent | PyPI 包 + MCP native + 演示视频；流程=检测挑战页→升级穿越→写带引用报告 | ⭐⭐ 反爬升级路由的现成参照（wigolo 分层 fetch 路由的激进版）；注意合规边界，抄行为规格不抄绕过细节 |
| jasonzliang/caesar-agent | 8 | 2026-05-01 | 08-31 | 145 | Apache-2.0 | 自主研究 agent，有 arXiv 论文背书 | **图式深度 web 探索（Perceive-Think-Act 循环）+ 对抗式工件合成**；带 llm-as-judge 评估模块和 brave_search/arxiv_explorer 等真实工具层 | ⭐⭐ 图式探索（页面→节点→再扩展）比线性 query 列表更能兜住长尾；评估模块可直接对标我们 fusion 排序 |
| vishal-raaj-dnd/open-research-lite | 3 | 2026-07-26 | 08-30 | 230 | MIT | 研究 agent 的**省 token 中间件**：差分知识状态追踪 + 概念 diff 抽取 | 自称对打 GPT-Researcher 省 55.9% token（有 Zenodo 论文+基准 JSON）；上 PyPI，230 commits 工程完整 | ⭐⭐ "只喂模型知识增量，不整页重灌"——research loop 上下文预算的具体解法，值得实测复现它的基准 |
| taxueseek/argo | 115 | 2026-07-18 | 09-01 | 163 | MIT | 给 agent 用的**中文多域搜索基础设施**（DeepSeek Harness 插件，我们 dsh 生态的同类） | 150+ 引擎、12 个 MCP 工具，覆盖中/英/学术/代码/购物/金融/新闻/百科，不依赖任何订阅账号 | ⭐⭐ 垂直面清单（购物/金融/百科分引擎）就是 xchain 的选题库；同生态可直接对照 dsh-search-boost 的报告读 |
| 0xmariowu/Autosearch | 44 | 2026-03-26 | 08-07 | 741 | MIT | MCP-native 的多通道研究基础设施，npm 包+Claude Code 插件双分发 | 40 通道含 10+ 中文源；"LLM 解耦"——只出索引化多源结果，不绑任何模型 | ⭐⭐ 通道清单+LLM 解耦的分层与我们 provider 池同构；741 commits 的通道维护经验值得抄清单 |
| BuyWhere/buywhere-mcp | 10 | 2026-04-16 | 09-02 | 168 | MIT | **商品搜索 MCP**：3 亿+商品，覆盖美国/新加坡/东南亚 | agent 自主选品的垂直搜索面，MIT | ⭐ 购物面单独成 provider 的先例（xchain 候选） |
| kenchengkc/the-financial-document-retrieval-engine | 2 | 2026-06-04 | 09-02 | **650** | GPL-3.0 | SEC 财报**点时（point-in-time）检索**：混合搜索+引用核验+**弃权（abstention）** | 带类型化的金融实体抽取；"检索不到就明确弃权"是硬性设计；650 commits 对 2★，纯被低估 | ⭐⭐ point-in-time 语料观（防未来函数）+ 显式弃权，垂面 provider 的工程范本 |
| Br0ski777/web-search-x402 | 0 | 2026-04-12 | 09-02 | 34 | MIT | **x402 微支付搜索 API**：agent 按 HTTP 402 协议按次付费 | 结构化 title/URL/snippet 返回；同作者还有 x402 抓取/report 系列——"agent 自己付钱买检索"的雏形 | ⭐ 计费面设计备忘（若 search-core 将来提供付费通道） |
| dublen5269/Sicry | 2 | 2026-03-28 | 09-02 | 41 | NOASSERTION | **Tor/.onion 访问层**：单文件给 agent 开暗网搜索（18 个 onion 引擎）+ OSINT 管线 | socks 代理+stem 控制 Tor；注意：license 未声明、作者名与仓库名对不上，工程薄 | ⭐ 仅作"暗网面"存在性记录；引入需法务评估 |
| Yuuzulight/Wisp | 0 | 2026-08-14 | 08-15 | 6 | none | **无状态答案引擎层**：SearXNG 之上补 rerank→全文抽取→再排序剪枝→带引用合成 | 哲学卖点="不建索引、不缓存、不存任何东西"——与 wigolo 的"缓存即搜索面"完全对反 | ⭐ 无状态/有状态是部署光谱的两端，给我们 engines.md 的部署模式讨论提供反例 |
| Ban-away/DeepResearch | 1 | 2026-05-21 | 08-31 | 11 | none | LangGraph 多 agent 深研系统（中文） | Supervisor 调度 Research/Draft/**Red Team**/Evaluator 四角色，红队 agent 专做对抗式质量审查 | ⭐ 把"红队审查"做成研究循环的常驻角色（多数项目只有 evaluator） |
| askalf/amnesia | 7 | 2026-02-22 | 09-02 | 65 | MIT | 隐私元搜索（amnesia.tax 在线可玩）：无追踪无历史无账号 | 155 引擎、每次查询走 VPN 隧道、API 带 bot 门禁；README 自曝"引擎覆盖的真实数字" | ⭐ 隐私威胁模型表（vs Google/Bing/DDG 逐项对照）值得抄进我们的隐私声明 |
| yubinkim444/ai-first-search | 1 | 2026-05-18 | 08-26 | 7 | MIT | 搜索→多 URL 抓取→净 Markdown 的三段管线，自称 Tavily/Exa 免费替代 | 思路=把"搜索 API"重新定义为"搜索+净化语料"一体交付 | ⭐ 与我们 fetch 层"返回即用语料"方向一致；仅 7 commits，观察其后续 |
| lukefwalton/answer-engine | 3 | 2026-06-12 | 07-08 | 126 | Apache-2.0 | 站点级答案引擎："会说'我不知道'的 AI" | 只答自有语料；**"该弃权时弃权"每条承诺都有对应测试**；非聊天式无状态问答 | ⭐⭐ 弃权+测试化的产品契约；站点语料场景与我们 FTS5 缓存检索的出口形态接近 |
| kecven/scouts-ai-mcp | 0 | 2026-06-06 | 06-15 | 13 | MIT | 把 SCOUTS-AI 搜索 API 包成单个 `web_search` 工具的 MCP | 卖点=无 key | ⭐ 无 |
| jiatai661-arch/deepresearch-agent | 1 | 2026-08-07 | 08-31 | 6 | none | 带检查点的 plan-execute 研究 agent | 受控工具+证据接地报告 | ⭐ checkpoint 思路已知（deer-flow 更完整） |

---

## 三、主表 · 活跃档（>10 星，0-300 区间，同样活跃）

| full_name | stars | created | pushed | commits | license | 它是什么 | 搜索后端/思路亮点 | 对 search-core 可抄的 |
|---|---|---|---|---|---|---|---|---|
| Evokoa/pgContext | 252 | 2026-07-21 | 08-15 | 129 | Apache-2.0 | **"装进 Postgres 的完整 AI 搜索引擎"**（Rust 扩展，PG17/18） | 混合稠密向量+全文检索、filter-aware ANN、MVCC 可见的精确重排——把向量引擎特性集塞进数据库 | ⭐⭐ "检索发生在存储层、重排对事务可见"——若 search-core 缓存上量，FTS5→pgvector 的演进参照 |
| fivetaku/insane-research | 242 | 2026-01-29 | 08-24 | 47 | MIT | Claude Code 插件：7 阶段多 agent 深研 | 3-5 个 agent 并行（web/学术/技术源），**每个来源打 A-E 质量分**+三角验证 | ⭐⭐ 来源 A-E 评分制，可直接加进 fusion 的共识加权 |
| jkudish/librarium | 129 | 2026-02-20 | 08-28 | 427 | MIT | 多 provider 研究编排 CLI（npm），evidence-aware | 显式 provider 档案规划→执行→**记录全过程**；**离线 canonical fixture 回放**（确定性重放研究流） | ⭐⭐⭐ "研究流可录制/可回放"的测试方法——search-core 目前没有这层 |
| openJiuwen-ai/deepsearch | 119 | 2026-02-26 | 09-02 | 324 | none | 知识增强型 deep search 框架，主打 chunk 级质量 | 自称行业领先的分块-检索链路（未逐行核验，框架较重） | ⭐ chunk 质量分级思路可留档 |
| h4444433333/net-deep-research | 123 | 2026-07-30 | 08-25 | 32 | MIT-0 | "可靠性优先"的研究技能包（SKILL.md+CLI，上 ClawHub） | **来源声誉检查**+更安全的 URL 抓取+结构化证据反馈；定位是"少被骗"而非"搜得多" | ⭐⭐ 来源声誉分=融合排序的第二维度；MIT-0 许可证干净 |
| albertyuee/deep-research-agent | 84 | 2026-05-19 | 07-27 | 79 | none | Agentic RAG 深研 agent（中文） | agent 自主拆解→选检索策略→评估→自我纠正→带引用报告 | ⭐ 无超出 gpt-researcher 框架的新机制 |
| LunonAI/lunon-deep-research | 71 | 2026-05-19 | 06-25 | 509 | MIT | 机构级分析定位的研究 agent | 在 DeepResearch Bench 上自评；509 commits | ⭐ 基准自评的姿势可学（我们可拿 DeepResearch Bench 当验收） |
| Battam1111/omniseek | 48 | 2026-06-29 | 08-31 | 161 | Apache-2.0 | **感知型 MCP**：音频/登录墙/评论区/跨语言/像素层都算"可搜" | "答案在播客第 47 分钟/三层楼深的评论里"——把 ASR、登录会话、线程展开、翻译都做成 MCP 工具 | ⭐⭐ xchain 的"非网页面"清单现成：播客 ASR 面、登录会话面、评论区面 |
| yoloshii/gigaxity-deep-research | 57 | 2026-05-04 | 08-17 | 100 | MIT | 开源 deep research MCP | Qwen3-30B-A3B-Thinking 走 OpenRouter 做带引用合成 | ⭐ 用 thinking 模型专做合成、便宜通道做检索的分工实证 |
| qntx-labs/qmd | 41 | 2026-02-02 | 07-20 | 26 | MIT/Apache | Rust 本地搜索引擎三件套（lib/CLI/MCP） | BM25+向量+混合+查询扩展+重排，面向本地文档集合 | ⭐ 本地语料面的候选引擎（比 FTS5 多了向量，比全 RAG 框架轻） |
| Aryan-Pardeshi/DeepResearch_AI | 54 | 2026-07-01 | 09-02 | 44 | 未声明 | 双模式研究工作台 | DeepSearch（2 分钟引用报告）/Research Mode（长研究）快慢双档 | ⭐ 快慢双档与 morphic 的 Quick/Adaptive 同思路，再证此为标配 |
| robbyczgw-cla/web-search-plus | 26 | 2026-01-20 | 08-31 | 77 | MIT | OpenClaw 技能：排名链接+抽取正文，明说"不做 Perplexity" | source-only 分发，v4.0.0 | ⭐ "只做检索不做合成"的克制定位 |
| rekursiv-ai/wesearch | 4 | 2026-07-22 | 09-02 | 196 | Apache-2.0 | agent 的 web 研究工具箱（"wascally"） | 工具箱形态，196 commits 持续迭代（未深读） | 待读 |
| Calyndrae/RemielleDesktopAgent | 1 | 2026-08-05 | 09-02 | 105 | MIT | 桌面陪伴 agent（Rust/Tauri），keyless web search 是能力之一 | 427MB 的大仓，游戏化陪伴产品 | ⭐ 无 |
| EdF2021/ithaka | 0 | 2026-07-15 | 09-02 | 2176 | AGPL-3.0 | 自托管 AI 工作台（chat/agent/笔记/日历/deep research 全家桶） | 深研只是其中一个模块，超本文范围 | ⭐ 无 |
| imjszhang/js-deepresearch-agent | 0 | 2026-05-24 | 09-02 | 83 | ISC | 本地单人 Node.js 深研（Express+Vite+SQLite） | SearXNG 可插拔适配器+本地历史 | ⭐ 无（标准做法的 Node 版） |
| dan-rozhkov/webharvest | 0 | 2026-08-10 | 09-02 | 109 | none | 本地 MCP：SearXNG 搜索+Playwright+Readability 抓取 | 与我们 keyless-apis+fetch 分层同构 | ⭐ 无新机制，但印证此组合是"社区默认架构" |

---

## 四、观察档（过门槛但存疑/不推荐抄）

| full_name | stars | commits | 一句话 | 为什么只是观察 |
|---|---|---|---|---|
| dalpat/answer-engine | 1 | 14 | 诚实的业余版 Perplexity（BYO OpenAI 兼容端点，README 有"the honest bits"自曝限制） | 工程量小，机制无新意 |
| Alex72-py/openplex | 4 | 14 | 终端里的 Perplexity Pro 替代 | 同上 |
| yoloshii 之外的低星 SearXNG 壳：Vednat19/perplexed-ai-answer-engine(2c)、b2230765034(2c) | 0 | 2 | 未过 commit 门槛 | 直接过滤 |
| RapidAI/RapidSearch | 1 | 23 | 知名 OCR 组织出的"agent 搜索服务"（Go） | README 信息量不足，形态未明 |
| Ziplootapp/free-local-ai-search-engine-ollama-rag | 0 | 34 | "免费本地 AI 搜索引擎"营销向 README | 45KB 仓库配大话 README，AI 垃圾嫌疑 |
| hewcarroll/kala-mcp | 1 | **3** | "无 key 研究 ritual+伦理门控"的 MCP（SearXNG/arXiv/GitHub） | 思路有趣（keyless+伦理门控）但 **3 commits 未过门槛**，记名观察 |
| aledegad/tentenco/trakkr-aisearch 等各路 awesome-geo/awesome-ai-search | 4-33 | - | AEO/GEO 资源清单 | 纯清单类，按规则不入选（附录记一笔） |
| api-evangelist/*（phind/kapa-ai/tako 等） | 0 | - | API Evangelist 的第三方 API 档案 | 档案页非产品 |

**明确过滤掉的"挂羊头卖狗肉"**：
- **AXT224/AXT-SEEK**（0★，"2026-09-02 创建"却有 1011 commits）——README 自认"built upon the open-source Vane project"，是 Vane/Perplexica 的换皮重发布（.assets 里直接放着 vane-screenshot.png）。/star/ 改名潮的 2026 延续：上轮我们记录了 BunsDev 318★ 的 Perplexica 改名镜像，这轮是 0 星层也在干同样的事。
- **tilde-research/one-layer-deeper**（80★）——名字像深研产品，实为 ML 训练竞赛，纯关键词撞车。
- **Aimaghshoodi/lumynax-\*** 系列——十几个 GGUF 模型灌包仓库刷 "deep research" 关键词。
- 大量 0★ 同名壳：`Gaini2001`、`QJH-0`、`Jaxuu`、`risaysalm` 等当天创建的 DeepResearch 空壳；`adityanegi600/arshhveer` 两个一字不差的 "Adaptive-Private-Knowledge-Search-System"（同文双发，明显的 AI 批量生成）。
- 职位搜索 agent（job-search agent）约 15+ 个混进 "search agent" 词表——全是求职自动化，不是搜索引擎。

---

## 五、最有思路的 8 个，逐个点评（重点：它跟主流做法哪里不一样）

1. **OpenSaC（2★/154c）——它把"搜索"从 API 调用变成了写代码。** 主流 agent 搜索是"固定工具调用循环"：search→fetch→search→fetch，步数和形状都是预设的。OpenSaC 实现 Perplexity 今年公开的 Search-as-Code 抽象后，让 agent 直接生成一段 Python：批量发查询、join 两个来源的结果、按条件过滤、融合排序、抽取结构化字段，最后打印只含来源范围内结论的输出——整段程序扔进 Docker 沙箱，所有特权操作（联网/落盘）经 capability broker 放行。对我们最大的启发：search-core 的 fusion 管线是"写死的",而它证明了"检索逻辑可以是生成的"，代价是安全面从函数调用变成代码沙箱。
2. **gainsay（0★/8c）——它不打算给你正确答案，它给你"可以吵的答案"。** 全行业在卷答案质量分，它把产品定义为"智力正当程序"：每条断言可溯源、来源冲突**原样展示而非投票合并**、权重计算可见、任何结论都可申诉重走、同输入同路径可复现。最狠的是把这一切写进 CONSTITUTION.md 当约束性文件。commit 只有 8 个，但这个方向直接补了我们"失败标注契约"的上游——我们标注"失败",它标注"分歧"。
3. **Polaris（1★/347c）——它抓到了所有 SearXNG 用户都在踩但没人写下来的坑。** 自托管 SearXNG 被上游引擎限流/弹验证码时，会**静默返回空结果而不是报错**——你以为"没搜到"，其实是"搜不了"。Polaris 把"全空=故障"做成显式检测，然后 Brave→Parallel→Tavily 逐级降级，每条结果标注 `[via provider]`，全部降级失败就明说"搜索已降级"，绝不把故障伪装成"无结果"。这三件套（静默失败检测/来源标注/显式降级声明）就是我们 v0.3 失败标注契约的成品参考，还是单 Go 二进制内嵌 UI 的分发形态。
4. **deepr（10★/1067c）——研究不是一次性报告，是一个会成长的"专家状态"。** 主流深研产物是一份 markdown 报告，用完即弃；deepr 的产物是持久化的信念/缺口/矛盾/置信度/出处/结果记录，下次研究基于上次的状态继续，修订要过 review 门禁。10 星配 1067 commits + mutation testing CI，是被严重低估的成熟度。对我们：这直接是 research loop 落盘 schema 的现成设计——FTS5 缓存存页面，这套存"学到了什么"。
5. **passiveworkers（1★/93c）——用"多模型各查各的+盲编辑"替代"单模型多轮反思"。** 主流自我纠正是同一个模型反复看自己的输出（容易同源幻觉相互强化）；它让多个本地 Ollama 模型作为独立分析员各自检索写作，再由一个看不到分析员写作过程的"盲编辑"合成保留分歧的单一引用报告。反锚定设计+全本地零云，和 gainsay 是同一思想的两个独立工程化——两个 0-1 星仓库同时想到"反共识合成"，说明这是真实的未满足需求。
6. **deepcloak（60★/39c）——"反爬墙"从麻烦变成了卖点。** 我们在 8-b 实测撞墙（DDG JA3 封 202 空页、Wikimedia 拒 h1），主流应对是换源绕开；deepcloak 反过来正面刚：检测 Cloudflare/Turnstile/Datadome/reCAPTCHA 挑战页→自动升级穿越→继续出引用报告，打包成 PyPI+MCP 一键接入。它证明"能读别人读不了的页面"本身就是 agent 市场的硬需求——但也提醒我们这条路的法律/封号风险，wigolo 式的"分层升级路由"是更稳的中间态。
7. **omniseek（48★/161c）——它把"搜索"的边界推到了文本索引之外。** 它的开场白就是产品定义："答案在播客第 47 分钟、评论三层楼深处、登录墙后面、另一种语言里——你的 agent 反正拿得到。"ASR 转写、登录会话、评论线程展开、翻译全部做成自托管 MCP 工具。这其实是 SurfSense 连接器思路的"深读"变体：不止接入平台 API，还把"非索引内容"逐个攻破。对我们 xchain 的启发： Reddit/HN 之外，播客 ASR 和评论区展开是两个没人做、用户真的在等的面。
8. **librarium（129★/427c）——它给研究流装了"黑匣子+录像回放"。** 主流研究 agent 出了错只能重跑碰运气；librarium 按 provider 档案规划请求、执行、**完整记录发生了什么**，还能离线回放 canonical fixture——同一份录制数据可以确定性重放整条研究流来回归测试。这是搜索工程里最缺的一环（我们的 smoke 测试还是真实联网裸跑）。"录制/回放"再加 ultrasearch 的"check 不过就 fail"，就是 search-core 测试体系的完整拼图。

---

## 六、给 search-core 的直接行动清单（按性价比排）

1. **抄 Polaris 的静默失败三件套**（全空=故障检测 / `[via provider]` 标注 / 显式降级声明）——v0.3 失败标注契约的参考实现，成本最低。
2. **抄 ultrasearch 的 `check` 命令**：报告内悬空引用/无来源断言 → 直接 fail。和我们 fusion 的"全词命中加分"天然衔接成证据校验。
3. **抄 deepr 的信念状态 schema**（belief/gap/contradiction/confidence/provenance）当 research loop 的落盘格式；FTS5 缓存管页面，这套管结论。
4. **研究 librarium 的 fixture 录制/回放**，替代裸联网 smoke 做回归。
5. **看 OpenSaC**：把 fusion 管线留一份"可编程出口"（生成的检索程序+沙箱）作为 v0.4+ 的预研方向，不急于实现。
6. **fusion 增量**：来源 A-E 质量分（insane-research）+ 来源声誉检查（net-deep-research）作为第二加权维度。
7. **xchain 选题**：播客 ASR 面（omniseek 证明需求）、商品面（BuyWhere）、中文多域面（argo/Autosearch 的通道清单直接抄）。
8. 观察不动手：Tor 面（Sicry，法务风险）、微支付通道（web-search-x402）、反爬正面穿越（deepcloak，抄行为规格不抄细节）。

---

## 附录 A · 趋势速记（本层特有，上轮高星扫描看不到的）

- **AEO/GEO（被引用侧）工具井喷**：elmo(290★)、canonry(129★)、ansvisor(104★)、aeo.js(131★)、GetCito(180★)、dualmark(103★)、lumioguard-tools(15★)、MalteBerlin/LLM-Referrer(21★, LLM 引擎 HTTP referrer 清单)。搜索引擎的"供给侧 SEO 产业"正在 AI 搜索上重演——对我们是"数据面"信号：这些工具的探测端点本身可反向用作"AI 搜索引擎清单"。
- **Vane（原 Perplexica）换皮层正在下沉到 0 星**：AXT-SEEK（0★/1011c 导入式 commits）是本轮实锤。
- **skills.sh / ClawHub / Claude Code plugin 成为新的分发层**：ultrasearch（skills.sh）、net-deep-research（ClawHub）、insane-research/Autosearch（CC plugin marketplace）——"成品"不再只是 docker compose，技能包是第三种发布形态，且迭代速度远快于全栈产品。
- **学术论文开始挂进新苗仓库**：caesar-agent（arXiv 2604.20855）、open-research-lite（Zenodo DOI）、OpenSaC（引 Perplexity research 文章）——个人项目直接以论文为背书，2026 年的新玩法。

## 附录 B · 扫描方法与命中统计

- 扫描日期：**2026-09-02**；搜索 API 共 **19 个请求**（限额 30/分钟，实际每请求间隔 3s）；核心 API（commits/repos/trees）约 120 次（5000/时配额内）。
- 统一过滤条件：`stars:0..300 created:>2025-01-01 pushed:>2026-06-01 fork:false`；per_page=30。
- 各搜索词命中总数（total_count，含未过人工筛选的原始命中）：

| # | 搜索词 | sort | 命中数 |
|---|---|---|---|
| a1 | `AI search engine in:name,description` | updated | 2167 |
| a2 | `answer engine in:name,description` | updated | 1270 |
| a3 | `open source perplexity in:name,description` | updated | 76 |
| a4 | `perplexity alternative in:name,description` | updated | 19 |
| a5 | `deep research in:name,description` | updated | 4820 |
| a6 | `deepresearch in:name,description` | updated | 447 |
| a7 | `web research agent in:name,description` | updated | 2333 |
| a8 | `search agent in:name,description` | updated | 14343 |
| a9 | `ai powered search in:name,description` | updated | 9986 |
| a10 | `research agent in:name,description` | updated | 24952 |
| b1 | `searxng in:name,description` | updated | 755 |
| b2 | `topic:ai-search` | updated | 684 |
| b3 | `topic:deep-research` | updated | 360 |
| b4 | `topic:answer-engine` | updated | 22 |
| b5 | `open deep research in:name,description` | updated | 200 |
| c1 | `AI search engine in:name,description` | created | 2167 |
| c2 | `topic:deep-research` | created | 360 |
| c3 | `answer engine in:name,description` | created | 1270 |
| c4 | `deep research in:name,description` | created | 4820 |

- 噪音结构（供下轮扫描参考）：`search agent`/`research agent`/`ai powered search` 三词命中总量最大但噪音率 >95%（求职 agent、RAG 课设、编码 agent 各占一极）；`topic:answer-engine` 命中最少但**信噪比最高**（22 个里捞出 Wisp/gainsay/dalpat/lukefwalton 四个）；`searxng in:name,description` 是挖"免 key 新苗"的第二富矿。
- 验真流程：19 词 → 去重后 ~120 个候选 → 50 个过 commit/license/language 初筛 → 20 个过 README+trees 抽查 → 22 个入选主表。
