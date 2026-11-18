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

## 范围

本地来源通过证明DSH调用路径、搜索解析、融合、缓存及失败透明性，不证明默认公网引擎如今全部可用，也不证明搜索质量达到所有研究任务。公网来源受网络、配额、验证码与服务版本影响；未经测试不标为通过。

~~~sh
node asset-manager/probe-search-mcp.mjs
# PowerShell设置安装包路径后：
node asset-manager/probe-dsh-host.mjs
~~~

独立测试结束回收自建fixture、DSH测试profile、cache与workspace。失败日志存私有.asset-state/evidence用于排查，不上传用户数据。
