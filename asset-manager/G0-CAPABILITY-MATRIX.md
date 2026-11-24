# G0 全量盘点与可追溯缺口矩阵

状态：**G0 现状确认（2026-11-24）**，基于 main 88faeb39（issue #4 第一阶段）。数据来源：skills-status、audit-usability、audit-resources、audit-provenance、preflight、capabilities/find-capability 实际运行输出（本文件所有数字均可由 CLI 复现）；不重复发明已有能力，只标注真正缺口。后续 G1-G3 见文末阶段衔接。

## 1. 盘点基线（工具实测，非文档计数）

| 审计项 | 结果 | 命令 |
|---|---|---|
| Skill 登记 | 123/123（individual 51 / vendors 71 / management 1）；坏 frontmatter 0；未登记 0 | `skills-status` |
| 可用性（dsh） | 137 资产：CONTENT_READY 48 / CONDITIONAL 5 / BLOCKED 84（75 厂商许可 + 9 MCP 宿主/配置） | `audit-usability --client dsh` |
| 资源引用 | 248 显式引用：225 存在 / 21 缺失（全在厂商内容）/ 2 示例；越界/目录链接拒绝 0 | `audit-resources` |
| 来源治理 | 上游未核实 60 / 声明受限 4（DOCX/PDF/PPTX/XLSX）/ 厂商运行复核 71；同字节组 0 | `audit-provenance` |
| 任务目录 | 14 路线 / 15 个不同 Skill 映射（精选子集）；10 厂商 name 跨客户端不兼容；5 组同名提供方 | `capabilities` |

## 2. 能力组覆盖矩阵（工作流生命周期 × 领域）

图例：✅=有已审阅主选（CONTENT_READY 且 CURRENT）；◐=部分/仅方法；✖=缺口。阶段列含义：RC=需求澄清、RS=调研、PL=计划、EX=执行、QA=测试/审阅、DL=交付、MT=维护/更新/回滚。

| 领域 \ 阶段 | RC | RS | PL | EX | QA | DL | MT |
|---|---|---|---|---|---|---|---|
| 工程 | ◐ writing-plans（偏软件需求） | ✅ search-core+research Skill | ✅ writing-plans / executing-plans | ✅ engineering 组（debug/refactor 等） | ✅ verification-before-completion / webapp-testing | ◐ 交付核验=原则性方法 | ✅ asset-manager 版本/stage/approve/rollback/恢复 |
| 研究 | ◐ 同上 | ✅ source-index / search-core / skill-search | ◐ executing-plans 复用 | ◐ 无专业领域工具（统计/实验） | ◐ 无独立复核（peer-review 缺） | ✅ research 报告产物（doc-coauthoring） | ◐ 结论时效复核=缺 |
| 办公 | ✖ 业务访谈/成本评估 | ◐ search-core 通用 | ◐ requirements-planning partial | ✅ DOCX/PPTX/XLSX/PDF（受限许可，见 §4） | ✖ 办公产物评分量表/业务审批 | ◐ quality-acceptance 原则性 | ✖ 排期/预算（business-scheduling 路线存在但无资产映射） |
| 设计 | ◐ ui-design 可承接需求澄清后的视觉执行 | ◐ | ◐ design-system 组件规范（偏实现） | ✅ ui-design / webapp-testing | ◐ 视觉回归缺专用工具 | ◐ | ✖ 设计系统版本治理缺专用流程 |
| 安全 | ◐ authorized-analysis-scope 前置授权 | ◐ | ✅ threat-model | ◐ 安全工具链依赖环境（nmap 等） | ◐ security-workflow 检查表 | ◐ | ◐ |

每格的证据与输入/输出/交接条件明细见 `catalog/capabilities.json` + 各资产 toml（CLI 可查）；本表不重复其正文。

## 3. 缺口分类（issue #4 分类法；每项含优先级/替代/证据）

| # | 缺口 | 分类 | 优先级 | 替代来源 | 证据 |
|---|---|---|---|---|---|
| G0-1 | 业务访谈/需求澄清（非软件）无专用技能 | 缺技能 | 高 | 通用访谈方法论需独立实现；同源查重已做（audit-provenance 同字节组 0） | capabilities: requirements-planning scope=partial，"未覆盖通用业务访谈、成本评估" |
| G0-2 | 业务排期与资源预算路线空映射（business-scheduling 无 primary 资产） | 缺技能 | 高 | 无合法同源；只能独立实现或标 BLOCKED | capabilities.json：14 路线中唯一无映射项 |
| G0-3 | 办公产物完整验收（Word 排版/PPT 视觉/Excel 公式量表） | 缺流程接缝 | 高 | verification-before-completion 提供原则；docx/pdf 等 4 项本地许可受限（audit-provenance declared_restricted=4） | quality-acceptance scope=partial；USABILITY 4 项受限 |
| G0-4 | 21 项资源缺失（全在厂商包） | 缺资源（区分：可能示例/内部依赖） | 中 | 逐项核对：真缺失→上游补；示例路径→标 dynamic；原厂内部依赖→标 unknown 不删除 | audit-resources missing=21 |
| G0-5 | 60 项上游身份未核实 | 未验证 | 中 | 保留 UNKNOWN；npm/GitHub 检查能力已存在，逐项核验 | audit-provenance upstream_unverified=60 |
| G0-6 | 71 厂商 Skill 许可/宿主复核 | 缺许可 | 中 | 无（不能绕过；reviewed-vendor 不能绕 DOCX 类限制） | audit-provenance vendor_runtime_review=71 |
| G0-7 | 研究领域专业工具（统计/实验设计）与独立复核 | 缺技能 | 低 | 超出当前 DSH-only 运行时目标，如实标注不虚报 | 研究行 QA=◐ |
| G0-8 | 安全工具链执行环境（nmap 等） | 缺环境 | 低 | 执行前阻止并给替代（G1 契约要求） | security 行 EX=◐ |
| G0-9 | 阶段交接断层：计划→执行→验收的机器可校验契约（输入/输出/批准点） | 缺流程接缝 | 高 | 现有 executing-plans 纪律为文本级；G1 要定义有版本的工作流契约 | asset-manager 有资产版本治理，无任务流程契约 |
| G0-10 | 语义冲突治理仅预检（名称/依赖/环），流程阶段方法矛盾需候选级证据输出 | 缺流程接缝 | 中 | G2 目标：文件/行与条款证据、触发组合、严重度 | preflight 只覆盖结构层 |

## 4. 已有能力复用清单（G1 不重复实现）

结构检查（requires/conflicts/环/名称/重名预检）、Expert 继承、Profile 追加、三方差异、人工 approve、activate 指针、rollback、恢复包、部署保护、任务目录只读路由、来源/许可/版本四类独立锁、来源审计 CLI、资源引用检查——全部存在且有测试；G1-G3 在其上扩展，不重建。

## 5. 阶段衔接

- G1（技能组与工作流补齐）：优先 G0-1/G0-2/G0-9——先查同源/许可，无法合法复用则独立实现或 BLOCKED；每个优先流程需代表性成功任务+缺依赖/取消/失败交接测试。
- G2（冲突治理）：先复现 G0-10 及现存冲突（要求子代理 vs 用户禁止、强制全局加载、目录不一致、重复安装、版本不兼容）。
- G3（来源核验/版本更新/组合兼容）：G0-5/G0-6 逐项核验 + 临时消费项目演练升级/回滚；本任务不授权定时任务/自动更新/自动批准。

## 6. 复现命令

~~~sh
node asset-manager/cli.mjs skills-status
node asset-manager/cli.mjs audit-usability --client dsh
node asset-manager/cli.mjs audit-resources
node asset-manager/cli.mjs audit-provenance
node asset-manager/cli.mjs capabilities --client dsh
node asset-manager/cli.mjs preflight --expert research --client dsh
~~~
