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
| Asset Manager | 59 PASS，1 SKIP（总60） | 原件保护、失败路径、路径边界、审批、连续回滚、配置生成、清空运行态后的恢复 |
| Search-core TypeScript | 292/292 PASS | 原有解析、调度、缓存、研究与本地测试服务；不是所有公网来源当前可用 |
| Memory-net核心 | 29/29 PASS | SQLite记忆、隔离与CLI行为 |
| Memory-net DSH Adapter | 21/21 PASS + 真实独立DSH headless通过 | Memory-net工具、注入、持久化、自指过滤；销毁关闭全部workspace契约；不改用户live profile |
| Memory-net Console | 构建成功，21/21服务测试PASS，Edge真实点击冒烟PASS | 认证拒绝/连接、进度和轨迹写入、键盘激活、统计、搜索及刷新读回；不是完整可访问性或全平台覆盖 |
| Zai-bridge Go | go test ./... PASS | 本地及隔离测试，没有动真实Z.ai账户 |
| Firefox | 491/491单元测试PASS，构建成功 | 本地实现保留；平台fixture已修复；真实交互待验 |
| DSH Skill filesystem provider | 实装0.2.2-rc.1从当前dsh Profile在隔离ctx读取7个Skill成功，0警告 | 真实provider list/get；未更改运行中DSH配置，测试视图结束后回收 |
| Search-core MCP | initialize + tools/list PASS | 真实服务器子进程和标准MCP客户端；不调用外部搜索 |
| npm来源查询 | 安全拒绝 | 本机DNS返回受禁止地址，未绕过公网限制、未应用更新 |
| Search-core Go | 未通过构建 | ONNX依赖在CGO_ENABLED=0时被排除，当前无C编译器 |

## Profile 与 UI 阶段

- 基础提交 2f8519e 已推送功能分支，GitHub 草稿 PR #2：https://github.com/tomjiu/agents-hub/pull/2；main 未合并。
- profile-view 从三个客户端 Profile 展开 Expert 和显式引用，拒绝不安全配置与不存在/错误类型资产；读取禁用 Profile 只生成候选，不改变启用状态。
- Console真实点击测试发现自动选择工作区后标题仍显示“选择工作区”：新增前置回归断言复现失败，再在选择/空列表时同步标题并重新跑真实交互。
- 本地证据存于 .asset-state/evidence/console-click.json 和 console-click.png；测试使用随机令牌、临时记忆库、实际Edge及HTTP服务，结束后浏览器/服务/数据回收。公开记录不包含临时令牌。
- 原Console旧哈希构建文件仍保留，新的HTML引用新哈希；不因重建误删迁移清单中的原始产物。
- 非空MCP视图与重名Skill拒绝新增回归测试；未支持的宿主插件明确报告，不假装已安装。
- asset-manager/verify-staged.mjs 移除意外NUL字符，改用显式字符构造；现在可作为普通文本审阅。

## 显式项目部署阶段

- 新增 plan-deploy / deploy / inspect-deployment / uninstall。只处理Profile选择的Skill；显式项目与批准参数必需，MCP/插件选择拒绝部分安装。通过真实CLI子进程与隔离项目验证预览、安装、查看及撤销。
- 目标已有同名Skill阻止整组安装；部署完整摘要包含点文件、缓存名及空目录，用户修改阻止整组撤销。正常撤销移入项目quarantine，不永久删除字节。失败/未确认内容与中断锁保留给人工核查；并发部署、多Skill中单项冲突或修改、REMOVING状态拒绝续删均有回归测试。
- 隔离消费者项目实测：批准安装7个Skill，实装DSH默认.dsh/skills发现和全文读取通过，修改后撤销被拒绝，恢复后quarantine回收成功，默认发现变空；现有AGENTS.md未修改。证据见 dsh-project-deployment-verification.json。
- 这不是live DSH插件安装或真实Codex/OpenCode会话验收。probe-dsh-deployment.mjs的测试项目与状态均已回收，当前用户项目不变。

## MCP 配置阶段

- plan-mcp / inspect-mcp / apply-mcp / rollback-mcp 从Profile或显式Expert选择服务；独立候选保留原配置字节，审核后配置/启动器/源码/入口变化拒绝应用，当前配置本地修改拒绝回滚。
- Codex追加完整TOML表；OpenCode保留JSON无关字段，已有JSONC不自动处理，cwd由无shell启动器固定；DSH生成逐服务Cordis patch，不改运行中实例。鉴权/环境映射未验证时明确拒绝。
- 使用共享消费项目锁与全局状态锁；应用/回滚journal记录中间状态，失败保留配置和恢复产物，不自动删除可能属于用户的内容。
- 真实CLI生成、应用、查看及回滚三个配置后，用标准MCP客户端启动实际Search-core：initialize、tools/list及一次本地tool_search通过；DSH额外通过实装0.2.2-rc.1 Config。见 mcp-config-verification.json。
- 全套60项：59通过、1项文件符号链接测试因Windows权限跳过；目录junction拒绝已单独通过。这是协议调用与schema验证，不是实际Codex/OpenCode会话或live DSH插件启用。
- 独立只读审查子任务未返回结果，未将其计为通过；Lead复核差异并执行测试。

## 真实 DSH 宿主阶段

- 实装DSH 0.2.2-rc.1独立headless派生profile实测，使用本地脚本化模拟模型和隔离DSH_HOME，不调用付费模型或修改运行中GUI。
- 当前Profile部署的Skill由真正skill工具读取完整正文（去除frontmatter，规范化CRLF后全文比对）；生成MCP patch加载Search-core并将本地tool_search结果返回模型；Memory-net插件写入和工具结果回流、注入与SQLite落盘同时通过。见 dsh-host-verification.json。
- 复用已有mock-model和verify-e2e，不删原断言；模拟模型可选MCP/Skill分支不改变旧冒烟默认行为。
- 增加ctx.effect销毁绑定及事件订阅this绑定，关闭全部记忆workspace并防止陈旧工具/事件重新打开；适配包21项测试通过。
- 这证明实际独立DSH宿主接入，不证明真实用户profile安装、所有版本或付费provider鉴权。复跑见 asset-manager/DSH-HOST-ACCEPTANCE.md。

## 重要修复

- Search-core原测试Windows下SQLite未关闭即rm造成EPERM：调整清理顺序，不跳过业务断言。
- Memory-net workspace不匹配的初始化失败漏关数据库：失败路径关闭连接；测试自身漏关实例也修复。
- Firefox对照Mozilla npm 0.9.5 commit b0f4495336b36b875cee29480150e660088c3e1a：131相同、20修改、12本地独有，故保留源码。详情见firefox-upstream-comparison.json。
- 厂商包许可与宿主依赖未经完整验收，默认未启用；Trae市场和WorkBuddy安装包发现标RESTRICTED。

## 尚未完成的硬门槛

1. 独立真实DSH宿主Skill/MCP/Memory-net闭环已通过；Codex/OpenCode实际发现调用、用户live profile安装和跨版本适配仍待验证。
2. Profile组合、Skill部署与MCP配置候选合并/显式应用/回滚已实现；真实宿主采用配置、依赖/插件安装与凭据映射仍未完整验证。
3. Search-core Go的CGO工具链和真实MCP协议验证。
4. Console核心真实点击及落盘闭环已通过；完整交互矩阵与Firefox真实浏览器服务仍待验。
5. 所有Skill旧机器路径清理、上游与许可精确映射、第三方同源重复审核。
6. 市场发现、审核解包与下载中断端到端测试；目前只下载原始字节。
7. 自动规则冲突检查、四项目规范完整候选和运行配置一致性验证。

## 范围与安全

没有启动替代DSH GUI，没有修改真实账户、用户MCP/插件配置或四项目当前规范。旧文件进入审计和研究目录，不参与自动加载；运行状态位于忽略的.asset-state。

完整目标未达成前，不把基础提交称为最终开箱即用版本。
