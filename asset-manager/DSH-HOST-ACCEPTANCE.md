# 真实 DSH 宿主验收

## 复跑

前置：Node ≥22.13，已安装DSH，以及根依赖、Memory-net核心/适配包的构建依赖、Search-core TypeScript构建产物。探针不下载DSH，不使用用户账户。

PowerShell示例：

~~~powershell
$env:HUB_DSH_INSTALLATION = '<installed @deepseek-ai/dsh directory>'
node asset-manager/probe-dsh-host.mjs
~~~

其他平台设置同名环境变量后运行。此处HUB_DSH_INSTALLATION指包目录，不是个人配置目录。P0当前实测宿主为0.2.2-rc.1与0.2.2-rc.5（历史rc.4记录保留）；其他版本必须重新验收，不能由结构类型或单元测试推断兼容。

## 完整链路

1. 在临时目录建立独立DSH_HOME与headless派生profile；只在其node_modules添加适配包/echo fixture链接。不触碰运行中的DSH或用户profile。
2. build:dsh预先构建核心、适配包和搜索；探针再次构建核心与适配包，预置仅测试用的约束、进度与workspace。
3. 按仓库dsh Profile实际部署7个Skill到临时项目.dsh/skills；从research Expert生成原生MCP patch。
4. 复用既有mock-model fixture，在127.0.0.1空闲端口启动脚本化OpenAI-compatible服务，模型请求只去本地。子进程环境仅复制必要OS路径变量；HOME/USERPROFILE/DSH_HOME指测试目录，凭据仅固定虚假测试key。
5. 真正运行安装包CLI，不是伪造ctx。模拟模型请求echo、memory_net_write、生成配置对应的Search-core MCP工具和skill工具；宿主完成工具执行后将结果返回模型。
6. 复用既有verify-e2e断言：工具注册、约束/进度注入、工具后推断重新组装、最终结果回显、SQLite推断落盘、echo自动观测及记忆工具自指过滤。
7. 增加断言：search工具查询本地SearXNG兼容来源，refs返回模型；重复查询命中缓存且只请求来源一次，SC_DATA_DIR在隔离目录。已部署asset-management Skill的完整正文（去除frontmatter，规范化CRLF）原样进入后续模型请求；不是只检查摘要或标题。
8. 回收已部署Skill，停止模拟模型并清理测试profile、workspace及视图。遥测DISABLED；不启动Web应用，也不调用公网搜索或真实账户API。

详见 [搜索功能验收](SEARCH-ACCEPTANCE.md)。当前DSH Search-core配置采用static预注册，避免调用中工具列表刷新。默认实际验证同批tool_search和search；HUB_DSH_PARALLEL_DISCOVERY=0仅供串行诊断，不能生成可批准的兼容记录；未改DSH官方bridge，也不证明其他动态MCP不存在竞态。

## 精选召回专项

设置HUB_MEMORY_P0=1与HUB_MEMORY_CURATED=1后复跑同一探针：预置持久tip，检查默认系统提示排除自动日志/未审阅推断/无上下文进度，实际memory_net_recall精选/显式raw结果均返回模型；SQLite仍保留独立观测及GC依据。两版报告含curated_prompt/curated_recall/raw_diagnostic。模型为本地脚本化fixture，不代表公网源或当前Web采用。未开启CURATED时，探针显式raw维持旧注入契约。

## P0专项

显式HUB_MEMORY_P0=1增加合成fixture的seed → 重复/无关echo → check → memory_net_recall链路。实际验证自动观测独立追加、promoted结论回到模型、GC保留旧依据；SQLite独立读取验证引用。fixture使用显式evidence审核，不模拟用户授权。核心另测传递闭包/引用环/失败回滚/写锁；宿主结果不代替这些测试，也不代表当前Web采用。见[P0记录](../catalog/audit/memory-provenance-p0.json)。

## 证据与限制

[公开验收摘要](../catalog/audit/dsh-host-verification.json)包含实际宿主版本、Skill/MCP闭环和原有断言摘要，无凭据值与用户数据。详细运行证据保存在忽略的.asset-state/evidence；不要公开复制真实用户profile的日志。

- 模拟模型是脚本化应答，不证明模型智能、付费provider鉴权或公网可用性。
- 这是实际独立DSH宿主测试，**不是把插件部署到当前运行中用户GUI**，也不是承诺所有宿主版本兼容。
- 本次只要求DSH；Codex/OpenCode实际加载不在验收范围。Console UI和Firefox服务是不同链路，不由此替代。
- 普通结束的回收已验证；进程被强制杀死、机器断电的孤儿进程/临时目录恢复不属本探针完整保证。
- 适配包增加可选ctx.effect数据库销毁绑定：全部workspace关闭，陈旧工具/事件不得重新打开；相应契约回归已通过。其他插件服务/工具注销依赖宿主作用域机制。
