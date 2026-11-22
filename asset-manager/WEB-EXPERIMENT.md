# 当前Web实验验收

用户明确授权在已有Web profile作实验并自行重启；不由代理重启、不改模型鉴权/Box/Z.ai/Clash、不导入既有记忆库。当前实验已通过真实会话工具路径，详见[实测记录](../catalog/audit/web-live-experiment.json)。这不是只用headless脚本模拟模型，也不是完整浏览器UI点击验收。

## 重启后发现并修复的差异

Web的Standard/PTC预设自带tool-skill。首次配置额外挂载宿主tool-skill，会让两个catalog hook竞争：宿主hook检查可见skill工具不是自己时输出空目录，预设hook却能发现真实目录。只读诊断已确认全局及当前作用域均有9个仓库技能和4个原有技能，文件与发现并未丢失。

最小修复是只禁用多余宿主tool-skill，保留预设工具与全局filesystem provider。当前会话恢复13项目录，9个仓库技能逐项调用skill并核对完整正文成功。headless没有预设工具时仍需要tool-skill；不能把此次Web修复机械推广为所有客户端禁用。不要重写用户预设插件列表，也不要替换preset/model来掩盖问题。临时诊断已从profile移除，没有改DSH实现。

## 当前实测

- 原Web实例自行重启后Search-core独立子进程存在，真实search返回候选；单独Keenable最新查询超时，诚实返回空与degraded，旧版本文档仍需检查。
- 实际fetch获取Node v26.13.1 API及SQLite WAL正文，transport=trusted-tun，重复缓存内容相等；直接保留IP被拒绝。
- memory_net_write写一条tip到独立web-experiment-check workspace，memory_net_recall命中；另一进程打开实验SQLite能读到同一节点。测试标记不是物理观测，原用户库未动。
- 本次4个原有技能和9个仓库技能可见；没有全部137资产混装或许可豁免。

## 保护与回滚

用户原profile内容作为字节前缀完整保留；package/global层哈希不变，模型鉴权未改。备份及restore-web-profile.ps1在用户仓库外私有备份目录，当前profile哈希更新后才允许恢复。若之后用户编辑配置，脚本拒绝覆盖，应人工仅移除agents-hub-web-experiment标记块。恢复前先停止实验Web，用户自行重启；绝不自动删除记忆或搜索库。

本次实验state已是用户运行数据，不再是可随意清理的测试cache。运行包源或宿主指纹变化需重新验收；下次启动仍以当前profile实际配置为准。当前修复已热重载，无需再次重启。
