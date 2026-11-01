# search-tool-rnd

逆向分析主流 AI 编程工具(含 Kimi 桌面版/Kimi Work 与 ZCode)的 agent 工作流 / 技能仓库 / 工具系统 / 搜索实现,并基于分析成果设计自己的搜索工具。

## 怎么读这套资料(新手指路)

仓库里的内容分两层:

- **易读层(大白话,先看这里)**——按主题分三个文件夹,每个产品一个文件,不用先懂行话:

| 文件夹 | 回答什么问题 | 从哪开始 |
|--------|-------------|---------|
| [1-技能与工具市场/](1-技能与工具市场/) | 各家怎么管理"技能"和"工具",有没有市场,怎么分发安装 | 先读它的 README(含 30 秒名词解释) |
| [2-工作流与架构/](2-工作流与架构/) | agent 怎么组织:单干还是带团队、何时停、上下文怎么省 | 先读它的 README(三流派 + 四条共识) |
| [3-搜索专题/](3-搜索专题/) | **本项目的核心**:每家怎么做搜索,我们能抄什么 | 先读它的 README(两大阵营 + 五条共识 + 反面教材) |

- **证据层(硬核,按需查阅)**——`reports/01-15` 是逐产品的完整逆向报告(反编译产物、strings 行号、代码片段),上面每个易读文件末尾都标了对应的证据指路。

推荐阅读路径:`3-搜索专题/README.md` → 挑感兴趣的产品读易读版 → 想验证细节再进 `reports/` 对应章节。

## 项目目标

**三阶段路线:**

1. ✅ **阶段一 — 逆向 14 个产品**(Grok Build / pi / dsh / ODR / Perplexica / Trae×2 / Qoder / WorkBuddy / Claude Code / Antigravity / Kimi 桌面版 / ZCode),覆盖 4 个维度:agent 工作流 / 技能仓库 / 工具系统 / 搜索实现 → `reports/01-15`
2. ✅ **阶段二 — 横向对比 + search-core v0 规格** → `reports/13` + `design/v0-spec.md`
3. 🚧 **阶段三 — 做自己的搜索工具** → `core/` 已迭代至 phase AM(50 provider/注册 47, 292/292 单测, MCP+CLI+REST 三出口, 三层权威域名体系(表外置 JSON 单一真源)+类目正主前排(2.0)+页面级守卫(多证据放行)+意图检测召回补齐+security/news 专线(CVE 三腿+双新闻 RSS)+词典/医学研究/数据类目官方面(wiktionary/europepmc/clinicaltrials/worldbank)+零结果抢救腿+OA 直链回退+早收割(延迟均值 -66%), vs-zai 全量 24 题 14 领域面实测: L1 连续双满分窗口+词典题 wiktionary top1+数据题 worldbank top1+权威命中 1.2-1.5×+延迟 1.5-2.2× 反超+csdn 主动屏蔽);详见 [PROGRESS.md](./PROGRESS.md) 与 [docs/](./docs/)

> 环境被清空了? → [RESTART.md](./RESTART.md) 一站式恢复:全部安装包地址、解包方法、工具链重建、进度快照。

## 分析维度(每个目标必须回答)

| 维度 | 关键问题 |
|---|---|
| **Agent 工作流** | 单 agent 还是多 agent?planner/executor 分离?如何决定调用工具 vs 继续思考?stop condition 是什么? |
| **技能仓库 (Skill Repo)** | 技能怎么注册/发现/加载?是 prompt-only 还是有代码层?版本化机制?用户自定义入口? |
| **工具系统 (Tools)** | 工具协议(MCP / 自定义 / OpenAI function-calling)?工具签名如何生成?运行时如何路由到具体 provider? |
| **搜索实现 (Search)** | 用了什么搜索后端?query 是否重写?多引擎路由策略?抓取策略?token 预算?缓存? |
| **上下文管理** | context window 怎么用?截断策略?长期记忆? |
| **模型路由** | 哪些任务用哪个模型?fallback 策略?本地 vs 云端? |

## 仓库结构

```
search-tool-rnd/
├── 1-技能与工具市场/    # 易读层:各产品技能+工具市场分析(按产品分文件)
├── 2-工作流与架构/      # 易读层:各产品 agent 工作流与架构(按产品分文件)
├── 3-搜索专题/          # 易读层:各产品搜索实现(按产品分文件,本项目核心)
├── docs/                # 方法论、目标清单、报告模板、法律说明
├── analysis/           # 每目标一个目录,放原始提取物 + 笔记
│   └── <target>/
│       ├── extracted/  # 解包后的代码(不提交到仓库,放 .gitignore)
│       ├── notes/      # 分析笔记
│       └── snippets/   # 关键代码片段引用(只放短片段,合规)
├── scripts/           # 反编译、解包、deobfuscate 脚本
├── references/        # 公开文档/论文/issue 链接
├── reports/           # 最终报告(交付物)
├── design/            # 我们自己的工具设计文档
└── raw-downloads/     # 原始二进制下载(不提交,放 .gitignore)
```

## 当前进度

见 [PROGRESS.md](./PROGRESS.md)。环境清空后如何恢复一切 → [RESTART.md](./RESTART.md)。

## 安全 & 法律说明

- 闭源软件的**完整反编译产物不进仓库**(只放 .gitignore 的本地目录)
- 报告里只引用**短片段**(单段 ≤ 30 行),并标注用途为"研究/互操作性分析"
- 详细规则见 [docs/legal-notes.md](./docs/legal-notes.md)
- 报告发布前请二次 review 是否触碰任何 EULA 条款

## Token 安全提醒

⚠️ 仓库初始化时使用过的 GitHub PAT 在对话里出现过明文,任务告一段落后请立刻去
GitHub Settings → Developer settings → Personal access tokens 撤销并重新生成。
