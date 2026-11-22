# DSH 搜索功能验收

## 不再把工具注册等同于搜索可用

probe-search-mcp.mjs通过标准MCP SDK启动真实Search-core，使用127.0.0.1动态端口上的SearXNG-compatible HTTP fixture：真实query进入provider、解析和融合后返回refs；重复查询返回from_cache=true且不再次请求provider；伪200 HTML错误来源返回空refs、degraded和引擎失败说明。

probe-dsh-host.mjs使用真实DSH headless让本地脚本化模型调用mcp__search-core__search两次，验证查询refs与缓存结果确实回到模型，同时保留记忆写入/注入/SQLite和Skill完整正文断言。不是改DSH内部实现或mock SearchCore。

## 隔离修复

Search-core实际读取SC_DATA_DIR，旧探针传SC_HOME并不起效。本轮改正为临时SC_DATA_DIR，HOME/USERPROFILE与测试DSH_HOME也独立，不读用户搜索配置。运行包原生MCP配置显式传SC_DATA_DIR到包内state/search-core，避免写入全局搜索缓存。包内state是用户数据，不自动清理。

fixture只在本地提供JSON，不将生产引擎地址改成本地，也不关闭生产SSRF策略。HTTP搜索provider已有用户配置baseUrl入口；搜索返回URL是明确测试域名，不读取公网网页或真实模型账户。

## 已发现的限制

旧DSH配置的动态渐进模式中，同批tool_search触发注册表刷新会让search报unknown tool（修复前真实复现，provider收到0请求）。当前自有DSH适配配置显式传SC_MCP_DISCLOSURE=static：启动时登记全部8个真实工具，tool_search仍检索能力，但不再变更wire工具列表。这消除了Search-core自身触发的重注册竞态，不修改DSH官方bridge。

默认无环境变量仍是dynamic，其他客户端不受改变；非法模式报错，不静默回落。static模式代价是首轮8个工具schema而非3个，未承诺所有外部MCP刷新都并发安全。

真实宿主探针默认进行并发回归（HUB_DSH_PARALLEL_DISCOVERY=0只能诊断，不能批准），模拟模型同批调用发现与查询，断言static发现结果、查询refs和缓存回流，无unknown tool；rc.1/rc.4及生成包均复验。已有旧profile或旧包必须重新生成/显式采用新配置，当前运行中的用户DSH不被自动更改。

## 显式provider选择修复

旧查询engines会被领域/GitHub/X链和rescue改写。当前统一验证每次调用的provider数组，去重/排序，[]为空名单、未知或错误类型拒绝。不传engines仍自动路由，默认池和未指定X链不取消。显式X名单使用所选provider做site:X查询，不调用官方/guest/oEmbed额外层；不等于承诺返回全是X域名或users专用格式。

MCP/HTTP search及x_search、CLI search/x支持名单；research/resume、CLI其他命令明确拒绝engines，不静默忽略。缓存key加入provider-allowlist-v1，旧缓存保留但不复用；cache命中仍检查来源标签，Bing旧标签兼容。不提供provider内部域名或embedding服务网络隔离，严格network firewall需另行实施。

宿主探针默认验证领域查询的选源元数据和双查询缓存回流，HUB_DSH_EXPLICIT_SELECTION=0仅诊断、不可批准。当前兼容门槛要求explicit_selection_verified，旧仅注册/串行/未核验选源证据不批准新资产。rc.5冷启动曾两次90秒超时，保留失败；帮助入口也约70秒，未确定根因。测试主任务预算调整为180秒且失败仍非零，两版及运行包通过，不称性能合格。

一次真实MCP公开查询只尝试bingrss/duckduckgo/yahoo，名单边界通过，但返回搜狗/企业页面等偏题结果且降级；不是搜索质量通过。官网fetch的DNS守卫问题未绕过，原研究失败记录保留。

## 真实偏题结果与质量门槛

本次抓到Bing RSS原始响应：请求q正确，最终重定向及channel link有时改写q；另外即使q回显一致，结果仍只有Node/SQLite宽泛首页。旧fusion只加词法分、权威加分清零而不拒绝，SearchCore未启用可选embedding相关阈值；ResearchLoop直接把router结果入池，零证据也可消费fetch预算。

现在Bing RSS只在最终URL或channel link确有q回显且与请求不同时报query mismatch；无回显不捏造校验通过。search/xSearch启用lexical-evidence-v1：NFKC/词级+CJK bigram、去常见停用/检索指令词、排除provider前缀和URL主机/查询参数；以title/snippet/path的词匹配数至少2或40%为最低门槛（单词题1）。它不是语义或事实判断，跨语言/纯URL/很短摘要可能被拒绝；证据不足明确no_relevant_results、degraded和拒绝计数，不输出假证据。候选通过也须核验版本、来源、内容。底层fuseSemantic默认保留兼容行为，entry point开启；embedding失败不恢复已拒绝结果。

Research新轮次在原主题上过滤引用后才入池，搜索角度通用词不当证据；search_quality写journal。既有研究journal重放内容属于历史输出，未自动删除或重写，也不是本轮质量认证。新cache策略provider-allowlist-v1+lexical-evidence-v1不复用旧key，并检查策略元数据及引用词证据，原缓存不删除。

真实MCP复测：原长Node查询60条原始候选剔55条，返回3个相关SQLite API文档但含旧nightly；WAL并发40条剔32条并找到sqlite.org/wal.html；简短Node SQLite DatabaseSync查询首位为Node v26.13.1当前API文档。这是实际题目的改善，不是泛化搜索准确率。SSRF官网fetch仍拒绝198.18.x，独立reader核验需明确披露。

本机Meta虚拟网卡DNS为198.18.0.2，公开域名lookup/resolve4返回198.18.x；仅证明此映射导致守卫拒绝，不认证代理服务内部原因。fetch新增可操作诊断：可信网络配置须返回真实目标地址，不能设ssrf=off或豁免网段。本轮未改用户DNS/代理，没有请求受阻地址。

兼容门槛新增quality_verified，宿主同批验证正常候选、偏题空结果/降级、名单与缓存回流；历史selection证据保留，新的质量报告用-quality.json。真实外网探针是node asset-manager/probe-search-quality.mjs --live，要求显式联网；独立测试不重复公网。

## 显式可信本机TUN抓取

后续按用户明确同意实现trusted-tun，而非要求改Clash配置。仅设置Search-core fetchNetworkMode=trusted-tun、fakeIpCidrs=["198.18.0.0/15"]、ssrf=strict；默认strict不变，不从存在TUN推断授权，不逐工具请求切换。原fakeIpCidrs宽豁免收紧，无法在strict放行保留IP字面量。

当前Clash/TUN真实MCP：Node/SQLite官网正文成功、重复缓存内容相等，strict同DNS拒绝仍保留；两版DSH的受控脚本模型调用真实fetch可看到正文与transport警告，并验证IP字面量拒绝。默认DSH探针只做离线搜索/拒绝，HUB_DSH_TUN_FETCH=1明确开启官方网络fetch，不默认出网。

范围和配置详见 [TUN抓取](TUN-FETCH.md)。remoteIpVerified=false代表没验证最终连接IP，strict也只有DNS预检查而非连接IP固定；trusted-tun只在用户信任的个人TUN环境采用，不把它当SSRF完整防御。模式/CIDR/域名策略缓存隔离，旧pages保留为历史语料。

## 范围

本地来源通过证明DSH调用路径、搜索解析、融合、缓存及失败透明性，不证明默认公网引擎如今全部可用，也不证明搜索质量达到所有研究任务。公网来源受网络、配额、验证码与服务版本影响；未经测试不标为通过。

~~~sh
node asset-manager/probe-search-mcp.mjs
# PowerShell设置安装包路径后：
node asset-manager/probe-dsh-host.mjs
~~~

独立测试结束回收自建fixture、DSH测试profile、cache与workspace。失败日志存私有.asset-state/evidence用于排查，不上传用户数据。
