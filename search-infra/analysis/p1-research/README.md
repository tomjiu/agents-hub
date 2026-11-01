# P1 深挖参考精读（Task 12-a，2026-09-03）

> 四个目标各出一份独立报告，全部源码级证据（GitHub API 体检 + raw 拉源文件精读），全部中文大白话。
> 与 P0（analysis/search-landscape/ 的 deep-*.md）的区别：P0 是贴脸对标（决定 search-core 怎么进化），P1 是"学设计不急着抄码"的外部参考——研究循环怎么写、调度器怎么老、技能包怎么发。

## 30 秒结论

1. **local-deep-research（最活的同类）**：策略五档全靠用户显式选+引擎 strengths/weaknesses 元数据拼进工具描述让 LLM 自选——**他们自己把"auto 自动选引擎"的元引擎删了**（口径散落 30 处的教训）；另有学习式限速器（10% 试探+EMA）和自动面/agent 面双开关两个可抄件。
2. **dzhng/deep-research（19.6k★ 教学骨架）**：整个研究循环 294 行——depth/breadth 两旋钮+每层广度减半+learnings 累积喂回+查询带 researchGoal 进化；**抄三个小件**（researchGoal/事实抽取硬约束/token 级 trimPrompt），旋钮本身不抄（我们双预算池+6 问反思更强）。
3. **SearXNG 调度器（8 年验证的老钱）**：验证我们熔断 2.0+软截止方向对；但有三处细节比我们好——**异常类型→挂起秒数显式表（CF 验证码挂 15 天）**、per-engine timeout 属性+全局 cap、滑动窗口"嫌疑升级"动态限速。weight 打分和实例防爬限流不抄。
4. **anysearch-skill（4 个月 6k★ 新形态）**：SKILL.md 是搜索能力的新分发渠道实锤——说明书即程序、agent 即运行时、runtime.conf 状态分离、batch_search（≤5 并行/共享参数/JSON 修复）是给 LLM 调用方量身定的接口纪律。抄形态不抄它背后那一个商业源。

## 四份报告导航

| 报告 | 仓库 | 活死判断 | 一句话收获 |
|------|------|---------|-----------|
| [local-deep-research.md](local-deep-research.md) | LearningCircuit/local-deep-research（9,023★/7,643c/2026-09-02） | **非常活跃**（每天多 commit） | 策略五档+引擎元数据驱动 agent 自选引擎；auto 元引擎被自己删掉的教训；学习式限速器入 backlog |
| [dzhng-deep-research.md](dzhng-deep-research.md) | dzhng/deep-research（19,629★/77c/2026-04-11） | **活着但代码冻结型**（示范仓库，读≫写） | 294 行讲完研究循环：查询带 researchGoal+learnings 喂回+广度几何收缩；抄三小件，旋钮不抄 |
| [searxng-scheduler.md](searxng-scheduler.md) | searxng/searxng（36,441★/9,692c/2026-09-02） | **非常活跃**（事实标准，大厂级节奏） | 分档挂起秒数表（CF 验证码 15 天档）+ per-engine timeout + 嫌疑升级限速；线程弃置式软截止与我们同构 |
| [anysearch-skill.md](anysearch-skill.md) | anysearch-ai/anysearch-skill（6,039★/63c/2026-04-30 建） | **活跃新星**（4 个月 6k★，持续发版） | SKILL.md 三级结构+runtime.conf 状态分离+batch_search 接口纪律；SKILL.md 分发形态的施工图 |

## 怎么读

- 只关心"下一步代码改什么"→ 每份报告直接看第四节表格（它有我们没有的，逐条已裁决）+ 第五节一句话裁决。
- 抄写优先级汇总（跨四份报告）：
  1. **provider strengths/weaknesses 元数据 → 拼进 MCP 工具描述**（LDR，改动小收益大）
  2. **熔断加"验证码超长档"+ per-engine timeout 属性**（SearXNG，直接搬数字）
  3. **Research Loop：查询带 goal + 事实抽取加"实体/数字/日期"约束 + 反思吐下一轮查询**（dzhng）
  4. **SKILL.md 三级结构 + batch_search MCP 工具**（anysearch）
  5. **错误回传脱敏 + 自动面/agent 面双开关**（LDR，一行级/一个标志位级改动）
- backlog 点子（暂不抄但记下）：限速试探放松（LDR 10% exploration）、代理池时挂起挂出口维度（SearXNG network key）、CLI --interactive 预反馈（dzhng）。
