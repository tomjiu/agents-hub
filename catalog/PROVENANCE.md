# 来源身份、导入基线与许可

## 三种身份必须分开

1. import.baseline_commit：原agents-hub本地迁移起点，只证明内容在本仓历史中的位置。
2. source.url：维护地址或服务地址，不自动证明这份内容来自该上游。
3. source.commit / version.commit：只有有实际证据的上游提交才填写；未知用空字符串，不拿导入基线冒充。

当前61项旧元数据曾把本仓4f191108基线写入commit字段。已纠正：60项曾保持upstream_identity_status=unverified；Firefox有已保存Mozilla 0.9.5比对证据，填写实际b0f4495上游提交。原始树哈希、本地修改、provenance逐文件基线、四类初始锁与历史Git全部保留。修正元数据不是重建源内容基线。

### G0-5 上游身份逐项核验（2026-11-25 完成）

60项unverified已全部完成内容寻址核验（[证据](audit/skills-g0-5-upstream-verification.json)）：真实上游为公开仓 github.com/tomjiu/agents-hub，导入原始内容在其 4f191108（旧布局）逐文件核实（raw / CRLF 重建 / EOL 不敏感三级匹配），当前内容与其 main 88faeb3 比对——58项逐字节一致（verified-upstream-match，source.commit=88faeb3）；mcp.search-core 与 memory-net 因本仓 #2/#3 开发在已核实上游基座上分化（verified-upstream-base，分化文件逐项在证据中列出）。memory-net 声明的独立维护仓 github.com/tomjiu/memory-net 已 404，url 更正为已核实的 agents-hub 仓并留有 url_history；keenable 服务端点实测存活（MCP 握手 200），tavily 端点降级（旧525已消失，现 401 需认证）。许可为声明值+许可证文件逐字节核实，不构成法律授权结论；G0-6 厂商许可复核仍待权利方输入。

## 历史锁的语义

catalog/locks是最初导入记录，不覆盖。其旧upstream_commit曾存在相同误标，需要结合本说明与当前元数据解释，不用于判断第三方有可下载的升级。export-locks向新目录输出选择，区分upstream_commit和import_baseline_commit；启用版本使用已审查的version.json上游字段，拒绝损坏内容。

## 声明许可证据

13项独立Skill保留LICENSE.txt，其中9项声明Apache-2.0，4项DOCX/PDF/PPTX/XLSX明确写有ADDITIONAL RESTRICTIONS，限制保留、复制、衍生及分发。登记文件路径与哈希，但不把声明当成已核实法律许可。

- 四项标restricted-declared，默认禁止view、项目部署、运行包以及新版本激活。--reviewed-vendor不能覆盖该拒绝。
- 对有效版本还读取LICENSE.txt，防止仅移除元数据标志就绕过限制。
- 不删除原件或许可证，不改写许可为Apache，也不将限制内容转写成“自研”规避授权。
- 已保留内容是否获授权、仓库分发是否合规，需用户/权利方另行确认。禁止部署不等于解决历史分发问题；本轮不擅自删除用户资产或改仓库可见性。
- 71项厂商Skill继续按已有review gate限制，CDN包存在不证明可跨宿主分发。

## 可复跑审计

~~~sh
node asset-manager/cli.mjs audit-provenance
node asset-manager/audit-provenance.mjs <new-report.json>
~~~

审计只读当前元数据和内容，输出逐资产来源身份、导入基线、许可文件哈希、当前/初始内容哈希和完全相同内容候选。当前136项未发现同类型完整内容相同组；这不证明没有部分文件重复，也不自动推断同源。

[当前审计](audit/provenance-verification.json)是明确范围的证据，不是全仓秘密扫描或完整法务判断。~~未核实60项真实上游版本属于待治理工作~~（✅ 2026-11-25 G0-5 逐项核验完成，见上方与 [skills-g0-5-upstream-verification.json](audit/skills-g0-5-upstream-verification.json)）。
