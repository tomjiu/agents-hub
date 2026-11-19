# Z.ai 0.3.1 修复与验收

本轮仅修复 zai-bridge，不实现Qwen、不请求产品API、不运行真实验证码SDK、不发送消息、不消耗额度。最多同时使用两个修复代理。

## 主要修复

1. **签名**：[sign.go](<./internal/zai/sign.go>) 第二层HMAC密钥使用第一层hex字符串，中文/长文本/窗口边界原前端3向量一致。
2. **严格额度**：[quota.go](<./internal/zai/quota.go>) 未知/查询失败/缺字段/耗尽拒绝写请求，出队原子预留最后额度，不把不确定受理额度回补；禁止skip保护。
3. **发送状态**：[send.go](<./internal/zai/send.go>) 区分not_sent/rejected/running/completed/unknown；已有输出、网络错误、受理未知、HTML或500不盲目重发。返回稳定message_id、user_message_id及partial。
4. **远端生命周期与队列**：[lifecycle.go](<./internal/zai/lifecycle.go>)、[throttle.go](<./internal/zai/throttle.go>) 同会话有界FIFO，账户名额跟随远端终态，不在本地SSE结束就归还；实际POST共享出口闸门及Retry-After。
5. **真实MCP并发**：[protocol.go](<./internal/mcp/protocol.go>) 默认8 workers/64等待请求、initialize顺序、EOF drain、取消和可恢复结果保留。
6. **身份隔离**：[accounts.go](<./internal/mcp/accounts.go>)、[config.go](<./internal/config/config.go>) 每次调用局部依赖，不修改共享闭包；多账户Cookie不继承；显式路径严格；重复token/JWT身份不能生成独立预算。
7. **验证码**：[captcha_pool.go](<./internal/zai/captcha_pool.go>) 保持2worker/3round，忙等待、超时/取消kill+Wait、故障worker恢复、Close幂等清理。不因求解失败空验证码裸发。
8. **文件/历史**：[storage.go](<./internal/zai/storage.go>)、[chatfiles.go](<./internal/zai/chatfiles.go>) 流式上传/下载与原子落盘；inline1MiB/流式256MiB、ZIP必须save_to；资源部分错误及404不丢。历史按100id批次、总2048条/32MiB；等待原消息不重复全量历史。
9. **边界及管理**：参数负值拒绝、显式0/缺省区别、UTF8裁剪、正确账户模型、消息done和agent终态区别，Pin/Archive读状态后幂等切换，CLI自检默认账户与失败清理修复。

## 最终独立审阅补修

- http.Do返回nil,error不能继承初始not_sent；否则已可能受理的请求会回补额度并重新入草稿。修复后网络不确定保持unknown、名额与额度，回归验证同prompt不会再POST。
- 成功发送返回后晚取消不能丢message_id；MCP内部SubmissionID标记保留内容并转isError，回归覆盖成功返回后取消。

## 验收证据

- `go vet ./...` 通过。
- 全包 `go test -json -ldflags="-s -w" -count=5 -timeout=120s ./...`：**87个不同测试/子测试（61个顶层测试），5轮，435通过事件，0失败**。
- 单独MCP与config曾20轮通过；最终全包数值以上述5轮为准。
- Windows实际exe离线假凭证握手：版本0.3.1，单账户19工具、多账户20工具，ping正常。只调用initialize/tools/list/list_accounts/ping，不发产品HTTP。
- Windows与Linux amd64本地产物构建通过。
- 具体哈希和测试摘要：[repair-verification.json](<./repair-verification.json>)。

## 可使用产物

- 原开发机Windows可执行文件已更新到0.3.1；公开仓库不含二进制，请自行构建。
- 原开发机Linux amd64二进制已生成；公开仓库不含二进制，本地镜像副本另保留。
- 原开发机旧Windows备份未包含在公开源码副本中。
- [README](<./README.md>)、[CHANGELOG](<./CHANGELOG.md>)、[多账户配置示例](<./accounts.example.json>) 已同步。
- Docker单账户使用[基础编排](<./docker-compose.yml>)，多账户附加[配置覆盖](<./docker-compose.accounts.yml>)。

## 不夸大完成状态

1. **Docker引擎未启动**，没有构建0.3.1镜像；旧latest仍可能是旧版。启动引擎后自行 `docker build -t zai-bridge:0.3.1 -t zai-bridge:latest .`。
2. Windows `go test -race` 连零测试启动也报0xc0000139，**race未验证**；建议在可运行race的Linux/CI环境再测。普通并发测试通过不等于race detector通过。
3. 没有新线上发送、验证码、状态/额度或产物兼容验收；静态与fake测试不能保证服务器保留bridge_draft等本地草稿字段。进程内记录可处理被标准化的本地草稿，重启后未知草稿保守拒绝。
4. 本地FIFO、run/额度预算不跨进程持久化，不与网页云同步排队协议联动。
5. 限速不是IP限制绕过；会员真实并发按你已知权益配置，不猜套餐映射。
6. 读取命令与输出不是独立可交互云终端；本轮没有新增此能力。
7. 文件和响应有限内存上限，但未重新量测RSS，不报恒定200MB或绝对低占用数字。

下一步只在你允许后做最小线上验收；不要默认运行[线上冒烟脚本](<./scripts/smoke.mjs>)的--write。
