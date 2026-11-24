# DSH记忆注入：社区对照与缓存修复

## 本次事故证据

指定会话本地事件记录显示：第60–79回合输入缓存94.23%，第80回合起约4.04%，累计62.78%。2026-11-24第106回合第1步cacheRead591689/cacheWrite828=99.86%；第2步cacheRead0/cacheWrite595526。模型/配置/工具哈希一致，无中间压缩；两份system正文唯一变化是排除观测数672→673，首个不同字符242。dynamic section被leading system replace和新series重发，不是尾部更新。原私有会话/工具结果未复制到仓库。停用后第109回合第1步99.97%为现有记录中的单次读数，不能保证长期均值。

## 固定版本源码对照（只读，不安装）

| 实现 | 核验版本与源码 | 注入做法 | 本次取舍 |
|---|---|---|---|
| haitang1/dsh-memory | [v0.5.8入口](https://github.com/haitang1/dsh-memory/blob/a218c920ff456beea528861c66bcd255f25d2e6a/lib/index.js#L493-L514)，MIT | systemPrompt.context，required:true，interpolate:false，动态摘要而非system section | 采用官方context接缝/literal，保留本插件证据复核，不引入其LLM自动提炼、embedding或权限策略 |
| NattoCB/dsh-plugin-memory | [a83fccef入口](https://github.com/NattoCB/dsh-plugin-memory/blob/a83fccef21f74d5242df5df0ab5c0be7ae8ddf8b/src/index.js#L167-L233)，MIT | agent/pre-step在消息入口追加用户上下文，已surfaced topic去重，索引/主题分离 | 不把记忆放system的方向相同；不照搬主题一次性集合，证据失效仍须重算 |
| LZMW/dsh-memory | [v0.1.2启动注入](https://github.com/LZMW/dsh-memory/blob/3551f4c49cdc67d7b544bb17292134cdab5beebe/lib/summarize.js#L469-L520)，MIT | 首次agent step注入用户profile，WeakSet防重复 | 避免重复/尾部添加可参考，但一次性冻结不能满足候选失效与cwd切换 |
| guntur-d/dsh-memory | [cc17aba源码](https://github.com/guntur-d/dsh-memory/blob/cc17aba9868122981e496380345e288d27bb8ac2/src/index.ts) | workspace-scoped持久事实和有界prompt section | 社区并非都已缓存安全；未确认许可，不复制实现 |

以上是源码静态对照，不是对所有插件安装运行/缓存或安全保证。元数据许可证是GitHub/package声明，不替代完整法务审核；本次没有将第三方代码纳入canonical资产或执行未知安装脚本。仅自身实现官方接缝。

## 自身修复

- system仅固定记忆规则，数据是user-role runtime-context，不给予system指令权限。
- 自动快照不含排除数/token/dropped；显式recall仍完整诊断。
- 稳定ID排序，字面注入花括号，每次准入重新验证scope/候选来源和review evidence。
- 使用宿主已提交runtime-context去重，不在plugin里记latest-agent或事先标记已发送，避免取消/重试漏注入。
- 变化追加完整当前快照；无节点/不可用明确撤回。历史快照保持但最新覆盖，尚未物理删除历史或做TTL摘要。

## 验收边界

实际DSH rc.1/rc.5局部模拟模型接收端比较system/tool hash与完整messages prefix；证据说明请求不再改写开头，不说明真实提供方路由/TTL/cache计量。另有四项适配行为回归和六项gate断言；当前Web保持停用，任何重新启用需用户明确授权。跨进程同会话恢复及运行包wrapper候选路径仍未单独验收；真实会话中的旧system内容要由正常宿主重组切换，不能通过改raw日志伪造结果。
