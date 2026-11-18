# v2 基础重构实施状态

状态：进行中；不是“全部客户端开箱即用已完成”。区分文件迁移、离线验证与实际宿主集成。

## 已完成

- 功能分支 refactor/asset-runtime-center；迁移前 Git bundle 在仓库外保存并验证。
- 基线 2,418 个文件建立原路径、目标、SHA256，搬迁后全部字节一致。后续定向修复单独列出差异，不隐瞒成原样迁移。
- 49 个原独立 Skill + search-core + 71 个厂商 Skill保持唯一内容位置；新增资产管理工作流。厂商包内部结构、Manifest、专家候选保留。
- Search-core TS/Go 分开放入 MCP，Zai-bridge与Firefox完整迁入；Memory-net核心、DSH Adapter、Console及vendor dist整体保留。
- Catalog登记136项资产：122 Skill、10 MCP、1插件和3组模板；稳定ID、来源、四类独立更新策略/基线锁、逐文件溯源及客户端配置意图建立，无自动覆盖或启用。
- 暂存核查发现10个旧忽略规则排除的原始运行产物，已明确纳入Git；全部2,418个原迁移目标以Git blob ID验证与当前工作字节相同。为避免clone时改变资源哈希，根.gitattributes保留字节及原换行。
- CLI基础来源检查、校验下载、三方差异、独立快照、静态验证、人工批准记录、版本指针、连续回滚、独立视图、AGENTS候选拼接、恢复包导出与非启用恢复。

## 已执行验证

| 范围 | 结果 | 能证明什么 |
|---|---|---|
| Asset Manager | 20/20 PASS | 原件保护、失败路径、路径边界、审批、连续回滚、配置生成、清空运行态后的恢复 |
| Search-core TypeScript | 292/292 PASS | 原有解析、调度、缓存、研究与本地测试服务；不是所有公网来源当前可用 |
| Memory-net核心 | 29/29 PASS | SQLite记忆、隔离与CLI行为 |
| Memory-net DSH Adapter | 20/20 PASS | 接口契约与事件接线；不是live profile安装 |
| Memory-net Console | 构建成功，21/21服务测试PASS | vendor dist与服务端路径；UI点击验收尚未完成 |
| Zai-bridge Go | go test ./... PASS | 本地及隔离测试，没有动真实Z.ai账户 |
| Firefox | 491/491单元测试PASS，构建成功 | 本地实现保留；平台fixture已修复；真实交互待验 |
| DSH Skill filesystem provider | 实装0.2.2-rc.1在隔离ctx中读取6个core Skill成功（加入 asset-management 前） | 真实provider list/get；未更改运行中DSH配置 |
| Search-core MCP | initialize + tools/list PASS | 真实服务器子进程和标准MCP客户端；不调用外部搜索 |
| npm来源查询 | 安全拒绝 | 本机DNS返回受禁止地址，未绕过公网限制、未应用更新 |
| Search-core Go | 未通过构建 | ONNX依赖在CGO_ENABLED=0时被排除，当前无C编译器 |

## 重要修复

- Search-core原测试Windows下SQLite未关闭即rm造成EPERM：调整清理顺序，不跳过业务断言。
- Memory-net workspace不匹配的初始化失败漏关数据库：失败路径关闭连接；测试自身漏关实例也修复。
- Firefox对照Mozilla npm 0.9.5 commit b0f4495336b36b875cee29480150e660088c3e1a：131相同、20修改、12本地独有，故保留源码。详情见firefox-upstream-comparison.json。
- 厂商包许可与宿主依赖未经完整验收，默认未启用；Trae市场和WorkBuddy安装包发现标RESTRICTED。

## 尚未完成的硬门槛

1. Codex/OpenCode实际发现调用、DSH live profile插件安装和跨宿主适配验证。
2. 从Profile完整合成部署、一键加载、客户端现有配置安全合并。
3. Search-core Go的CGO工具链和真实MCP协议验证。
4. Console/Firefox真实点击及前后端闭环。
5. 所有Skill旧机器路径清理、上游与许可精确映射、第三方同源重复审核。
6. 市场发现、审核解包与下载中断端到端测试；目前只下载原始字节。
7. 自动规则冲突检查、四项目规范完整候选和运行配置一致性验证。

## 范围与安全

没有启动替代DSH GUI，没有修改真实账户、用户MCP/插件配置或四项目当前规范。旧文件进入审计和研究目录，不参与自动加载；运行状态位于忽略的.asset-state。

完整目标未达成前，不把基础提交称为最终开箱即用版本。
