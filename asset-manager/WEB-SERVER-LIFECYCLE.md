# 本地Web测试服务生命周期

## 确认修复

webapp-testing原helper只连接端口判断ready。已有listener时即使新服务不成立也能跑自动化并返回0；另有未消费PIPE和只结束shell不结束子孙的问题。当前先验证全部端口空闲，再启动自己拥有的服务及测试命令，不杀已有listener。

可信shell命令仍可用--server；优先--server-argv JSON字符串数组，不拼接用户输入。--cwd应用于服务和测试。超时必须正数/有限，端口唯一且1..65535；参数坏在创建进程之前拒绝。默认每服务30秒启动、命令300秒，命令超时124、正常测试失败保留退出码，启动/清理失败非零。

## 使用示例

以下在Skill目录执行，Python需真实安装但helper仅用标准库；自动化另需自己的浏览器依赖。

~~~sh
python scripts/with_server.py --help
python scripts/with_server.py --server-argv '["python", "server.py"]' --port 5173 --timeout 30 --command-timeout 120 -- python automation.py
# 确认所有shell内容可信，才使用原入口：
python scripts/with_server.py --server "npm run dev" --port 5173 -- python automation.py
~~~

既有服务直接执行自动化，明确确认其身份，不用helper接管。helper不安装软件、不升级项目规则、不启动替代DSH GUI。

## 进程管理与输出

Windows使用独立kill-on-close Job Object。启动进程挂起，分配至job后通过NT进程恢复接口放行，防止新服务派子进程早于job归属。启动/测试失败、超时、SIGINT/SIGTERM/SIGBREAK或正常命令退出时，反向结束自有job，清理未完成的命令及服务子孙。测试明确观察Windows父helper被强杀后listener关闭。分配/恢复/清理失败非零，不默默继续测试。

POSIX实现新session/process group，退出先TERM再KILL；本次不认证Linux/macOS行为，强杀helper也不承诺group一定回收。Windows宿主不允许嵌套job时明确失败；不应关闭安全约束来绕过。

输出继承调用方，不存在helper内部无人排空的PIPE。调用方若使用PIPE必须排空或重定向，输出可能含项目敏感内容，不自动写公共日志。stdin关闭，不支持交互登录/安装等命令。

## Readiness局限

检查全端口、服务进程仍存活并达到TCP可达；不是应用健康/身份认证。预检查bind释放后到exec仍有抢端口窗口，不能绝对证明新listener归本job。自动化需检查预期页面或API，不能将TCP可达/固定sleep视为已完成初始化。对于长期连接应用，使用明确selector/response等bounded状态，不强制networkidle。

不得让启动命令连接已有daemon、脱离job/group或另开外部服务；这些不属于本helper支持的所有权。强杀发生于进程创建/归属建立前的极小窗口没有通用保证；只认证当前Windows测试场景。

## 实测范围

17项标准库真实子进程/127.0.0.1服务回归：占用端口（含第二端口）、真实HTTP正文、2MB噪声输出、多服务、失败码、超时、服务启动/运行中退出、shell父/子/孙清理、中断、Windows强杀、带空格cwd和shell特殊字符literal参数、无效argv/超时/无测试命令。全部使用临时合成服务。独立副本曾遇双服务夹具偶发失败且编码遮蔽诊断，已增加空探测/连接重置后真实HTTP回归；夹具不向无请求连接写入响应，捕获ConnectionError，并用backslashreplace保留诊断字节，不改实际helper输出编码。

~~~powershell
$env:HUB_PYTHON_EXECUTABLE = "<real Python path>"
$env:HUB_PYTHON_DEPS = "<private PyYAML/networkx directory>"
$env:HUB_GIT_EXECUTABLE = "<git path>"
node asset-manager/probe-python-tasks.mjs
~~~

探针还复跑先前11项Skill打包与4项Git归属任务，总32项。没有浏览器页面点击验收、真实账户/用户服务/DSH修改。
