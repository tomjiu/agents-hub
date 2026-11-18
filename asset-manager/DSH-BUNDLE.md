# DSH 独立运行包

## 生成与核验

~~~sh
node asset-manager/cli.mjs check-dsh <installed-dsh-directory>
node asset-manager/cli.mjs dsh-bundle <installed-dsh-directory> --memory
node asset-manager/cli.mjs inspect-dsh-bundle <generated-bundle-directory>
~~~

默认research Expert，选择核心Skill与Search-core MCP。--memory显式加入记忆插件，不更改默认Profile启用状态；省略时不加入记忆。可用 --expert <name> 选择其他配方，但未支持插件以及Search-core之外的MCP会拒绝（尚无真实包验收）。输出新的.asset-state/dsh-bundles/<UUID>，每次生成独立目录，不覆盖已生成包。

生成需要check-dsh为VERIFIED。DSH/记忆/搜索资产变化先完成 [升级验收](DSH-UPGRADE.md)，不能只靠版本号绕过。普通已批准但未建立编译运行时验收的active MCP/记忆快照当前拒绝打包，不悄悄使用未审核构建。

## 包含什么

- 所选Skill部署副本、来源与哈希。不需要写消费项目.dsh/skills。
- 原生bundle.patch.yml：配置已有skill-filesystem的customSkillDirs、每个MCP一个官方桥实例，明确加入记忆实例。
- 记忆适配包完整编译树的运行副本（不是新的维护源），ESM标记及文件URL加载包装器。不修改DSH profile node_modules，不下载或安装插件。
- bundle.json记载目标DSH安装路径、宿主/资产验收哈希、配置和复制树哈希。
- 搜索MCP显式SC_DATA_DIR指向包内state/search-core，不写全局搜索缓存；记忆默认使用包内state/memory-net/main，不导入、覆盖现有用户记忆数据库。状态变化不导致运行副本校验失效；状态目录链接不允许。

搜索MCP目前引用已经审核和构建的仓库源码/入口，其运行依赖仍在仓库内，不是可以搬离仓库的自包含安装包。运行包绝对路径不可移动；搬迁、守卫实现或内容变化应重新生成。

## 使用

输出launch字段含实际命令与参数数组。**先审查并inspect，再由用户明确选择宿主启动。** 已验证headless；不自动改运行中的Web GUI、profile或账户。

~~~sh
node <installed-dsh-directory>/lib/bin.js --profile headless --patch <bundle-directory>/bundle.patch.yml "<task>"
~~~

实际模型鉴权需用户自己的显式配置，包不会复制任何真实凭据，也不替换模型。对已运行Web profile不能直接承诺热加载；先在独立profile中测试，避免与已有记忆实例、MCP serverName或customSkillDirs冲突。命名冲突与已有配置合并仍需人工审查。

记忆包装器启动时核对目标DSH、运行副本及源资产；内容不匹配即拒绝激活。MCP/Skill可能先由宿主激活，所以必须运行inspect，不把记忆包装器校验说成整棵profile的原子授权门槛。运行期间依赖或代码被外部修改不在持续监控范围。

## 数据与回收

关闭所有使用该包的宿主后，才可决定保留/归档运行包。state可能含用户记忆，不提供自动清包命令。新生成包有新的记忆库；如需继承记忆必须另做有备份、审核的迁移。本轮避免为了“临时脚本清理”误删实际记忆。

## 验证与踩坑

HUB_DSH_BUNDLE_TEST=1配合HUB_DSH_INSTALLATION运行 [真实宿主探针](probe-dsh-host.mjs)，不用profile node_modules安装记忆包；由生成patch完成记忆/搜索/Skill加载、工具结果回流与落盘。

实际测试曾发现异步Cordis包装器返回HostApi对象会报Invalid effect，导致记忆插件没挂载。修复为异步入口只完成挂载、不返回该对象，且拒绝空激活结果；重新测试不是仅把断言改宽。

公开证据仅包含隔离测试，不能证明所有profile、平台或付费模型。目前rc.1与rc.4独立headless是支持证据；见实施记录。
