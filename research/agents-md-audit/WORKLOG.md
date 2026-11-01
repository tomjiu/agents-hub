# WORKLOG — AGENTS-EN.md 架构级审计

> 本文件遵循被审计对象自身的 §21 规范（紧凑阶段状态，非流水账）。

## Current phase
阶段2完成（逐节深析/提示工程量化/业界对照已入库并推送；token 已用毕待用户撤销）

## Completed verified work
- 阶段1：字符级取证（11 类全阴性）、结构提取（38 节点/59 指令/6 条只读命令）、供应链验证（7 仓库克隆扫描全良性）、架构逆向（六层/16 组件）
- 阶段2：量化指标（2,259 词/≈3,050 token/42 否定式/35 条件式，evidence/metrics.json）
- 阶段2：逐节深度解析上下篇（25 单元 × 意图/机制/深析三层 + 三个结构韵律）
- 阶段2：提示工程技术分析（首尾双锚/伪代码策略语言/休眠触发/证据词汇表/反断言/负面清单）与业界对照（agents.md 官方规范实抓、四层生态定位）
- 推送验证：origin/main = 本地 HEAD（git ls-remote 证据）

## Known failures
- GitHub REST API 匿名访问限流(403)（阶段1，已用 git 协议绕过）
- 上游扫描首版正则 O(n²) 超时（已修复）

## Open blockers
- 用户提供的新 token 已在对话中明文暴露，建议任务结束后立即撤销（Settings → Developer settings → Personal access tokens）

## Important decisions
- 上游克隆约 250MB 不入库（.gitignore），保留扫描 JSON 证据
- 08 文档对照基准采用实抓的 agents.md 官方规范（OBSERVED）与 open-agents 实测（OBSERVED），Claude/Cursor 部分标注 INFERRED

## Verification evidence
- source/AGENTS-EN.md 与原件 MD5 一致（6f28012f...）
- tools/ 五脚本在仓库内重跑输出与 evidence/ 一致
- 远程推送经 git ls-remote 验证

## Next phase
（用户决定）可选：对抗性红队测试（模拟注入攻击验证本文件约束的鲁棒性）、生成可直接部署的改进版 AGENTS.md（补注入防御条款与宿主机制对接）
