# 恢复包与连续回滚

## 修复的缺口

旧恢复包只保存当前active版本，虽然附带历史记录，却没有保存previous版本。新环境恢复后连续回滚可能找不到快照。schema 2现在打包当前选择和全部activation/rollback历史引用的版本（包括已回滚版本），按asset-id/version分目录；不删除历史、不把只备份当前内容标成完整恢复。

## 四个独立步骤

在已存在的新消费checkout根运行工具。先安装固定CLI依赖；恢复路径须是已核验的本地包。

~~~sh
node asset-manager/cli.mjs export-recovery <new-backup-directory>
node asset-manager/cli.mjs inspect-recovery <backup-directory>
node asset-manager/cli.mjs restore-recovery <backup-directory>
# 内容恢复不会启用。仅用户已批准新环境选择恢复时：
node asset-manager/cli.mjs restore-selection <backup-directory> --approve --reviewer <name> --note <evidence>
~~~

export由原checkout执行，另外三个命令由目标checkout中的CLI执行；不能拿原仓CLI误写原仓运行态。restore-selection不是下载/内容恢复的默认步骤；它确实发布active指针和完整回滚历史，但不改客户端配置、不启动DSH或其他服务。

## 完整性和所有权

- 导出串行化、验证原选择历史的一致性与快照内容/元数据，收集全部引用；缺失任何历史版本就失败，不留下普通半成品包。
- schema 2的selection摘要用于检测变化，回放历史校验previous/next/from和rolled_back标志；记录路径、ID/版本/类型/内容摘要必须匹配，不能替换无关版本。
- 复制结束再检查与预审包哈希一致，验证后来源变化则回收本次新副本而不报告成功。
- 只恢复缺失内容；任一目标版本已存在立即拒绝整批，不自动接管相同文件，不覆盖修改。普通中途复制失败移除本次已经创建的版本，原仓与既有版本不动。
- 选择恢复只接受不存在active.json的新运行态，连空active.json也不替换。审核者、理由和--approve必需；同一个operation.lock保护版本和选择操作。
- 再核验已恢复完整目录与包一致、所有引用版本验证/批准报告、当前许可政策及checkout哈希；改变过的批准记录、原内容或项目定制都会阻止选择恢复。
- 准备选择记录后以独占发布创建active.json，竞争者创建的文件保留；失败不回退成覆盖写。恢复revision加1，不复用旧CAS号；历史栈保持可连续回滚。
- 恢复批准审计记录可能在最终发布失败时保留，表示恢复意图而不是发布成功；以active.json和命令结果判断成功。普通失败清理自有pending state，强杀后仍须检查锁及临时文件。

## 旧包兼容

schema 1仍能inspect和restore内容，使用旧asset-id目录格式。但它只包含当前版本，restore-selection明确拒绝。可逐项审查/activate，或在原环境重新生成schema 2包；不能推断旧包历史完整。

## 不包含什么

包只包含已引用的资产版本与它们的审核记录/选择历史。未引用的暂存版本、实际DSH安装包、node_modules、普通dist构建缓存、MCP配置、用户profile、运行包私有记忆和搜索缓存不在包中。restore-selection使资产指针生效，不代表客户端加载或DSH运行兼容门槛通过；恢复后的MCP/插件仍需要对应构建及实际运行时验收。

这不是远端自动灾备、数字签名、多用户授权或通用任意资产许可证裁决。校验摘要与人工批准记录不能认证是谁审查；勿公开上传包含私有版本或审核信息的恢复包。

## 验证

新增回归覆盖3版本连续恢复/回滚、回滚后重新启用、回到基线、schema1兼容、历史闭包缺失/篡改、审核及checkout变化、许可拒绝、复制/pending写入/并发发布失败、锁与目录链接。实际CLI子进程验证export→inspect→restore内容→明确选择→连续rollback，不只是内部函数调用。

~~~sh
node --test asset-manager/tests/recovery.test.mjs asset-manager/tests/lifecycle.test.mjs
npm test
~~~

隔离目录和合成Skill数据，测试结束清理；不恢复用户DSH、不使用真实账户，也不改变原项目规范。
