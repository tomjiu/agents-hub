# v2 基础重构实施状态

状态：当前DSH-focused重构交付完成（明确限制保留）。只验收DSH，不要求Codex/OpenCode全跑通，不创建子代理。首次交付及后续恢复/并发修复历史证据保留；当前根测试138通过、1权限项跳过，latest rc.1与next rc.5的记忆/搜索均独立验收，新增技能发现入口。合并状态以GitHub PR为准，运行中的DSH不变。详见 [本次上手与最新宿主验收](onboarding-latest-dsh.json)及[初次交付](final-dsh-acceptance.json)，未认证资产不自动启用。

## 已完成

- 功能分支 refactor/asset-runtime-center；迁移前 Git bundle 在仓库外保存并验证。
- 基线 2,418 个文件建立原路径、目标、SHA256，搬迁后全部字节一致。后续定向修复单独列出差异，不隐瞒成原样迁移。
- 49 个原独立 Skill + search-core + 71 个厂商 Skill保持唯一内容位置；新增资产管理工作流。厂商包内部结构、Manifest、专家候选保留。
- Search-core TS/Go 分开放入 MCP，Zai-bridge与Firefox完整迁入；Memory-net核心、DSH Adapter、Console及vendor dist整体保留。
- Catalog现登记137项资产：123 Skill（新增本地skill-search）、10 MCP、1插件和3组模板；稳定ID、来源、四类独立更新策略/基线锁、逐文件溯源及客户端配置意图建立，无自动覆盖或启用。
- 暂存核查发现10个旧忽略规则排除的原始运行产物，已明确纳入Git；全部2,418个原迁移目标以Git blob ID验证与当前工作字节相同。为避免clone时改变资源哈希，根.gitattributes保留字节及原换行。
- CLI基础来源检查、校验下载、三方差异、独立快照、静态验证、人工批准记录、版本指针、连续回滚、独立视图、AGENTS候选拼接、恢复包导出与非启用恢复。

## 已执行验证

| 范围 | 结果 | 能证明什么 |
|---|---|---|
| Asset Manager | 138 PASS，1 SKIP（总139） | 原件保护、失败路径、路径边界、审批、连续回滚、配置生成、清空运行态后的恢复 |
| Search-core TypeScript | 296/296 PASS | 原有解析、调度、缓存、研究与本地测试服务；不是所有公网来源当前可用 |
| Memory-net核心 | 29/29 PASS | SQLite记忆、隔离与CLI行为 |
| Memory-net DSH Adapter | 21/21 PASS + 真实独立DSH headless通过 | Memory-net工具、注入、持久化、自指过滤；销毁关闭全部workspace契约；不改用户live profile |
| Memory-net Console | 构建成功，21/21服务测试PASS，Edge真实点击冒烟PASS | 认证拒绝/连接、进度和轨迹写入、键盘激活、统计、搜索及刷新读回；不是完整可访问性或全平台覆盖 |
| Zai-bridge Go | go test ./... PASS | 本地及隔离测试，没有动真实Z.ai账户 |
| Firefox | 491/491单元测试PASS，构建成功 | 本地实现保留；平台fixture已修复；真实交互待验 |
| DSH Skill filesystem provider | rc.5从当前core Profile在隔离ctx读取8个Skill成功，0警告；rc.1旧7项证据保留 | 真实provider list/get；未更改运行中DSH配置，测试视图结束后回收 |
| Search-core MCP | initialize、tools/list、search与缓存/失败路径PASS | 真实服务+本地HTTP来源；两版DSH查询及缓存结果回到模型；不证明公网来源全部可用 |
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

## DSH-only 与升级兼容阶段

- 用户明确只要求DSH，保留其他客户端适配但停止全客户端验收；用户禁止创建子代理后只由Lead工作。此前两个子任务没有结果，不计为审查。
- npm latest为0.2.2-rc.1，next为0.2.2-rc.4；候选rc.4独立固定版本安装于忽略的测试目录，不替换运行版。两版真实headless均验证Memory-net写入/注入/落盘/自动观测、自研Search-core MCP工具结果回流和Skill全文加载。
- check-dsh按宿主核心接口与profile文件、当前记忆/搜索源码和编译树及Node版本的精确指纹核对。新版本、同版本文件变化或资产变化均要求重新验收；不自动升级、启用或禁用运行会话。
- check-dsh-upstream沿用公网DNS安全校验；本机DNS映射被安全拒绝，未绕过。公开npm view人工核对得到channels，记录不充当审批。
- 兼容记录见catalog/runtime/dsh-compatibility.json；现有导入基线保持不变。

## DSH独立运行包阶段

- dsh-bundle / inspect-dsh-bundle组合所选Expert的Skill、搜索MCP和显式--memory记忆运行副本，要求版本兼容门槛通过。新包不覆盖旧包或用户profile，记忆默认使用包内私有state。
- 记忆编译运行树复制、完整摘要和文件URL包装器避免profile node_modules手工安装；包启动核对目标DSH与运行内容，改变时拒绝。搜索仍引用受审查仓库构建与依赖，不伪装成完全可搬迁安装包。
- 真正生成包在DSH rc.1/rc.4独立headless验证Skill全文加载、搜索结果回流和记忆注入/落盘。实测发现包装器异步入口返回HostApi对象导致Cordis Invalid effect；修正为挂载后不返回对象并拒绝空激活，保留原断言重新通过。
- 单测覆盖运行包内容修改、编译副本修改、意外用户文件、状态目录链接以及新宿主拒绝；运行包state不能自动清理。详见asset-manager/DSH-BUNDLE.md。

## 来源治理与许可阶段

- 61项当前元数据曾将本仓迁移基线充当上游commit，已拆为import.baseline_commit；60项上游身份保持unverified。Firefox填写已保存比对证据的真实Mozilla提交，不虚构其他来源版本。
- 13项独立Skill本地LICENSE.txt逐项阅读登记：9项声明Apache-2.0，DOCX/PDF/PPTX/XLSX四项声明明确限制。四项默认阻止视图/部署和新版本激活，人工vendor标志不能绕过；原件、许可证、历史锁与逐文件基线保留，历史分发授权问题未自动解决。
- 新增audit-provenance只读审计：136项，60上游未核实，4明确许可限制，71厂商运行/许可复核；同类型完整内容未发现相同组，不代表没有部分重复。
- export-locks现在区分本地导入commit与已审批启用版本的上游commit/版本，并拒绝启用内容篡改。初始四类locks不覆写。
- 许可门槛加入DSH指纹后，rc.1/rc.4真实记忆/搜索/Skill宿主重新验收通过；兼容记录按新资产指纹追加而不覆盖旧证据。

## 搜索功能与隔离阶段

- 纠正探针SC_HOME误用：实际Search-core读取SC_DATA_DIR；host/MCP探针缓存与配置明确指向隔离目录。运行包搜索缓存也显式写包内state/search-core，不接管全局搜索配置。
- 用本地SearXNG-compatible HTTP来源，标准MCP客户端实测query→refs、重复命中缓存、无重复来源请求、伪200 HTML失败的空refs/degraded透明返回。
- DSH rc.1/rc.4直接和生成包实际发起search查询、refs返回模型及重复缓存，记忆/Skill原有断言通过；不声称公网引擎全部可用。
- 实测发现同批并行tool_search列表刷新与search可能unknown tool，未修改DSH官方实现。使用先完成发现再执行的顺序，明确保留竞态限制。
- 新增build:dsh入口，检查依赖后只构建三个子包，不自动安装或启用；clone前置已列明。

## 下载与规范候选失败保护阶段

- 下载检测声明/实际体积、完整结束、中断/取消、状态与SRI长度，校验后生成独立原始产物；记录失败只回收本次目录。11项传输替身/实际文件测试通过，不声称真实TLS或CDN当前可用。
- 规则候选独立core/rules，核对来源/占位项/片段，锁定输出，sidecar先于正文独占发布；7项并发/源变/写入失败与用户内容保护测试通过。强杀恢复与语义冲突不假称实现。
- 修改视图模块指纹后，DSH rc.1/rc.4重新验收，历史证据保留，新指纹单独记录。

## 重要修复

- Search-core原测试Windows下SQLite未关闭即rm造成EPERM：调整清理顺序，不跳过业务断言。
- Memory-net workspace不匹配的初始化失败漏关数据库：失败路径关闭连接；测试自身漏关实例也修复。
- Firefox对照Mozilla npm 0.9.5 commit b0f4495336b36b875cee29480150e660088c3e1a：131相同、20修改、12本地独有，故保留源码。详情见firefox-upstream-comparison.json。
- 厂商包许可与宿主依赖未经完整验收，默认未启用；Trae市场和WorkBuddy安装包发现标RESTRICTED。

## 当前交付核查

提交6fefdfd的独立干净clone已按文档仅安装固定依赖并构建，77项根测试通过、1项跳过；两版DSH兼容指纹与原目录一致，生成包实际加载记忆/搜索/Skill通过，Console提交产物真实点击通过，Git tracked工作区干净，fsck与2,418目标字节核对通过。见 [干净副本验收](fresh-checkout-verification.json) 与 [交付矩阵](DELIVERY.md)。

下列仍为未认证或待授权事项，不因核心DSH链路通过而自动启用、升级或称为完成。

## 后续搜索竞态修复

- 用户要求继续修复后，首先真实复现DSH rc.1同批tool_search/search导致unknown tool且来源0请求。
- 自有Search-core增加显式static预注册模式；自有DSH配置使用此模式，启动时提供全部8工具，发现查询不再改变wire工具列表。默认dynamic模式保留渐进披露；不修改DSH官方bridge。
- 原路径重新验证rc.1/rc.4直接接入及生成运行包的同批发现、实际搜索、缓存回流和记忆/Skill链路，通过。4项SDK内存transport测试验证静态零列表变更、真实并行查询、动态默认兼容及非法模式。
- Search-core现296项通过，根97项中96通过、1权限项跳过；旧配置需明确重新生成，其他动态MCP刷新与公网搜索不在本修复保证范围。

## 后续恢复包完善

- 实测旧恢复包仅保存active版本，连续启用后缺previous快照；先建立失败回归再修复。schema2导出当前与全部history引用内容，保留完整回滚栈；schema1仍可恢复内容但拒绝历史选择恢复。
- inspect-recovery和restore-selection新入口：内容恢复永不自动选择；明确approve/审核人/理由且目标active.json不存在时，核对闭包、内容、review、许可和checkout后独占发布选择，旧状态与其他写入不覆盖，不启动服务。
- 16项恢复专项测试及1项历史导出回归通过，覆盖连续回滚、重启用/基线、schema1、篡改、锁/链接、许可、复制/临时写入/并发失败；真实CLI全链路通过。详见asset-manager/RECOVERY.md。
- 不打包DSH安装、node_modules、实际记忆库、搜索缓存或用户配置，普通崩溃自动恢复向导仍未实现；原始导入锁和provenance保持不变。

## 新代理上手与最新DSH检查

- npm观测latest=rc.1、next=rc.5（2026-11-19）；在私有目录固定安装rc.5，真实headless及生成包完成记忆工具/注入/SQLite、搜索并发发现/查询及缓存回流，不升级当前实例。兼容登记保留rc.1/rc.4旧证据、新增rc.5精确指纹。
- 根AGENTS.md增加四类预选入口与实际CLI命令：搜索MCP、Memory-net、source-index和skill-search；core Expert增skill-search（8技能），research另选搜索Skill和MCP，记忆仍须--memory显式创建。
- 新search-assets只读关键词检索和skills-status库存检查，4项测试包括真实登记/规范链接/预选组合。validate拒绝坏frontmatter、缺失或未登记技能。
- 123个canonical Skill全部登记，51独立、71厂商、1管理。security-workflow描述含未转义冒号造成YAML坏语法已修复，正文原样。10个厂商name跨客户端不兼容、5组同名提供方分别报告，不删除或偷偷改名。
- 当前137资产的存在不意味着全部可用：许可/厂商运行时限制保留，真实公网搜索与收费鉴权不在当前测试范围。

## 全仓索引体验与组合审核

- 真实任务“记忆插件”检索遗漏先失败复现；当前增加6个关键资产的discovery.description/aliases及中文二字片段、精确ID加权。137个稳定ID逐项检索命中、4类任务检索和4个Expert预检通过，不是语义模型或远端查找。
- audit-usability覆盖全部137项，默认DSH为48 CONTENT_READY、5 CONDITIONAL、84 BLOCKED；CONTENT_READY仅正文可读，阻止项包括75个厂商/许可Skill与9个MCP宿主/配置缺口。逐项原因不能被“库存完整”掩盖。
- 新preflight只读组合检查，重复Skill name/MCP runtime ID、声明requires/conflicts、循环和Expert继承/Profile追加排斥检查；BLOCKED返回exit1，view也执行相同组合规则。
- 人工复核修复4份工程Skill中的错误指令层级、全局强制加载与禁止派生时的子代理要求；旧导入基线/许可不修改。自动预检不保证任意语义指令无冲突。
- 实装rc.5 provider发现/读取全部48个正文合格技能、正文匹配且0警告，75个Skill排除并记录原因；不是全部脚本/专业任务验证。rc.1/rc.5记忆/搜索/并发发现重新验收，组合实现变更纳入指纹。
- 详见 [可用性指南](../../asset-manager/USABILITY.md)，本次报告记录真实检索、加载通道、结构及限制，后续专业任务/外部依赖仍需逐项审核。

## 第二层资源与离线任务审核

- 新audit-resources遍历全部123 canonical Skill的显式链接及资源名，./和仓库内../可正确检查、越界/目录链接拒绝，不执行任何资源。当前246引用中223存在、21未解析、2示例；21项均在厂商内容，不能据此判定均为缺失依赖。
- 3类独立断链修复：补充security/performance本地检查表（明确非找回的上游材料）、search-core修正失效链接、安全归属技能修正skills/skills旧命令路径。
- 11项技能打包离线回归通过：真实CLI/help/归档正文、空/重复YAML、旧输出、源内输出、私密文件与许可拒绝、源变化、写入失败和并发写入保护。4项安全归属合成Git历史→报告→查询及原输出保护通过。
- Python3.13.7用显式解释器和私有固定PyYAML6.0.3/networkx3.5，未修改Windows Store别名/全局配置；root新增3项资源回归，总135项134通过1跳过。见 [任务验收](../../asset-manager/TASK-ACCEPTANCE.md)。
- 未执行厂商/Office受限资产，也未验证所有Python/浏览器/外部依赖，with_server只核对help与源码、未声称服务器生命周期修复已完成。

## 本地Web服务生命周期修复

- 真实复现旧with_server把占用端口当自建服务ready，测试误连既有listener并exit0。修复为先检查全部端口、进程存活和稳定TCP可达，不接管既有服务；readiness不等于UI正确或认证端口所有权。
- 兼容可信--server shell入口，新增--server-argv JSON无shell和--cwd、--command-timeout；拒绝重复端口、非法/非有限超时、空命令。内部不创建未读取PIPE，输出继承调用者。
- Windows进程挂入kill-on-close job之前以挂起状态创建，成功归属后恢复，避免早派生逃逸；失败不运行测试，命令结束/中断/超时统一回收job内服务器与命令。POSIX用process group，但本次仅Windows验收。
- 17项实际CLI/HTTP回归通过，含噪声2MB、多服务器、命令7退出保留、124超时、SIGBREAK、强杀helper及shell祖孙清理，不改运行中DSH、不创建子代理。加入probe-python-tasks，总32项Python任务回归通过；根仍134通过、1权限跳过。
- [生命周期指南](../../asset-manager/WEB-SERVER-LIFECYCLE.md)保留跨exec端口竞争、应用身份检查、daemon/外部job限制及全平台未认证，不声称浏览器UI测试完成。

## Lead实际资料研究任务

- 不再以模拟模型脚本证明研究质量：Lead通过索引和preflight选择能力，真实Search-core MCP公开搜索Node SQLite→5引用/降级，独立读取固定版本Node/SQLite官方文档，核对本地实现并产出[决策报告](research-memory-sqlite.md)。
- 首位检索旧nightly，不直接当当前版本；指定engines被领域路由改写，尚未修复。官方全文fetch因本机DNS保留地址被守卫拒绝，Harness独立web_fetch替代，明确不算Search-core完整fetch链路通过。
- Node26.13.1实测Database/DatabaseSync同一类、SQLite3.54.1；文档给出弃用兼容别名/同步API，建议后续独立迁移。不将WAL当多写者或网络盘数据库，召回不当语义RAG。
- 临时Memory-net记录报告里的核验语句及inference，关闭后跨Node进程回读类型/based_on/正文；不触及用户记忆库。探针只重放已审阅输入，不再次验证远端内容。
- 修复搜索Skill旧core构建路径与Node22说明、记忆上游兼容过度承诺，source-driven-development增加官方文档任务别名及回归；没有API或router实现改动。
- 没有无技能对照、独立审稿或自由运行真实模型全流程，真实账户及全部研究题效果未认证。详见[任务记录](real-research-task.json)。

## 未认证与后续事项

1. DSH 0.2.2-rc.1与next 0.2.2-rc.4真实独立宿主记忆/搜索/Skill闭环已通过；用户live profile切换须另获明确授权。Codex/OpenCode真实加载不再是本次目标门槛。
2. Profile组合、Skill部署、MCP配置保护和DSH独立运行包已实现；rc.1/rc.4实际采用生成包已验证。现有用户profile合并与真实凭据映射仍须按授权另验，不能自动替换。
3. Search-core Go的CGO工具链和真实MCP协议验证。
4. Console核心真实点击及落盘闭环已通过；完整交互矩阵与Firefox真实浏览器服务仍待验。
5. 所有Skill旧机器路径清理、上游与许可精确映射、第三方同源重复审核。
6. 市场发现、审核解包与下载中断端到端测试；目前只下载原始字节。
7. 自动规则冲突检查、四项目规范完整候选和运行配置一致性验证。

## 范围与安全

没有启动替代DSH GUI，没有修改真实账户、用户MCP/插件配置或四项目当前规范。旧文件进入审计和研究目录，不参与自动加载；运行状态位于忽略的.asset-state。

当前DSH-only重构目标完成，其他客户端适配保留。完成不代表所有来源、全部资产或用户live profile运行验证完成；后续事项按独立授权继续。
