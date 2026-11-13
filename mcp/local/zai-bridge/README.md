# zai-bridge

把 **chat.z.ai 的网页会话**接成 MCP stdio 工具。Go 负责 HTTP、消息状态、额度和并发；Node 只用于验证码求解，不启动真实浏览器。**本项目仅实现 Z.ai，不实现 Qwen。**

当前修复版：**0.3.1**。这版验证使用本地 fake HTTP transport、假求解子进程和原前端签名固定向量；没有新的真实消息发送或额度消费。线上接口可能变化，不能把离线通过等同线上验收。

## 快速配置

登录网页后可自行取得 Bearer token：

```js
copy(localStorage.getItem("token"))
```

```powershell
$env:ZAI_TOKEN="你的token"
.\zai-bridge.exe
```

或在 `~/.zai-bridge/config.json` 配置：

```json
{"token":"你的token","model":"glm-5.3","max_concurrency":1,"send_interval_seconds":8}
```

曾观察到不带exp的token，但不保证永久有效；被注销或吊销后需你重新获取。本工具不自动注册账户、不代为登录。

AI客户端配置示例：

```json
{"mcpServers":{"zai-bridge":{"command":"./zai-bridge.exe","env":{"ZAI_TOKEN":"你的token"}}}}
```

启动读取命令只在你调用工具时访问Z.ai。`check` 会查询真实账户并运行验证码SDK；默认离线测试不会调用它。

## 多账户

参考 [accounts.example.json](<./accounts.example.json>)，创建自己的 `~/.zai-bridge/accounts.json`，或用 `ZAI_ACCOUNTS_FILE` 指定路径。真实凭证文件不要提交或分享。

```json
{
 "default":"work",
 "accounts":[
  {"name":"work","token":"账户A的token","max_concurrency":1},
  {"name":"personal","token":"账户B的token","model":"glm-5.3","max_concurrency":1},
  {"name":"vip","token":"账户C的token","max_concurrency":3}
 ]
}
```

文件存在时使用多账户模式。所有工具可传 `account`，省略则用default；`list_accounts` 列账户。各账户的token、Cookie、运行预算和额度独立，不继承顶层身份Cookie；同一token/JWT用户ID的重复别名会被拒绝，避免同身份得到多个预算。会员并发按实际服务权益配置，**不根据套餐名字猜上限**。

`ZAI_ACCOUNT` 覆盖default，未知账户拒绝；显式配置路径不存在、空账户列表、非法参数直接报错，不悄悄换成别的账户。

## 工具

| 工具 | 功能 |
|---|---|
| `list_chats` | 列表、search关键词、filter=archived/pinned；保留IM会话，不隐式过滤 |
| `list_tags` | 标签 |
| `list_models` | 可用模型，正确标出所选账户当前模型 |
| `get_chat` | 摘要、运行状态、workspace及分叉点 |
| `get_messages` | 消息、reasoning、tool_calls；leaf_id查看另一分支、since_id增量 |
| `create_chat` | 创建agent会话，message可存首条草稿；**不等于已经发送生成** |
| `send_message` | 同会话FIFO、额度保护、提交状态和message_id |
| `wait_for_reply` | 用message_id/after_message_id等原消息终态，返回partial与错误 |
| `get_usage` | token、功能额度、订阅及云盘统计；未知/locked不当无限量 |
| `list_files` | 账户级PFS文件/目录列表 |
| `upload_file` | 本地常规文件流式上传 |
| `download_file` | 文本小文件inline，save_to流式保存 |
| `delete_file` | 批量删除云盘文件 |
| `list_chat_files` | 会话legacy和PFS产物，保留部分接口失败信息 |
| `download_chat_file` | 单legacy文件或all=true PFS包；ZIP必须save_to |
| `rename_chat` | 改名 |
| `pin_chat` | 读状态后POST切换，避免重复调用反向切换 |
| `archive_chat` | 已归档则不重复切换 |
| `delete_chat` | 必须confirm=true，删除不可恢复 |

单账户19个工具；多账户额外 `list_accounts`。`limit=0`、`max_chars=0` 依各schema表示不裁剪；负数拒绝。服务仍有响应总大小保护，0不代表可无限占内存。

## 排队与并发

- **同会话FIFO**：key为账户+chat_id。队列最多64个等待者，支持超时/取消。父节点在实际出队时读取，不提前使用旧父节点。
- **账户并发名额**：默认1，可按权益配置1–64。远端任务未结束时保持名额，即便本地SSE已结束或调用取消。
- **MCP真实并发**：默认8个worker、64个等待请求；输出JSON-RPC按id配对，可乱序返回。Ping和取消通知保持响应。
- **进程内共享发送闸门**：所有配置账户同一出口的completions POST遵守默认8秒间隔；每次允许的重试也经过闸门，405/429遵守Retry-After并暂停。不同进程/其他客户端不共享这个闸门。

这是**本地排队**，并未实现网页排队的云同步协议，也没有网页“刷新”操作。验证码更新、签名和限速不保证绕过WAF；被拦时返回明确错误。

## 额度保护与重试

出队后先查agent_mode额度并原子预留，准备验证码和实际POST前再核对。

- 额度耗尽：不发completions；未知/查询失败/字段缺失：同样拒绝。
- 只有明确status=unlimited才当无限量，不以limit=null自行猜测。
- 同重置窗口，服务器迟到的高remaining值不会补回已预留/受理未知的本地预算。
- `skip_quota_check` / `ZAI_SKIP_QUOTA_CHECK=1` 已禁用，不能绕过严格保护。
- 进程内保守预算不能原子拦住你同时从网页或其他机器消耗额度。

`attempts` 为1–3总尝试数，默认1。**仅明确未受理、无任何输出的CAPTCHA拒绝可以同组id再试**。网络错误、HTML、SSE错误、500、查询不到或running不是重发许可；不会自动换新消息id重复发送。

所有已进入提交的结果保留 `message_id`、`user_message_id`、`state` 和partial正文：

| state | 意义 |
|---|---|
| `not_sent` | completion请求未发出 |
| `rejected` | 明确拒绝，不盲目重发 |
| `running` | SSE结束但远端尚未确认终态 |
| `completed` | 远端已确认完成 |
| `unknown` | 可能受理，需查询原消息 |

```text
send_message(chat_id="...",message="继续处理",account="work",wait=false)
wait_for_reply(chat_id="...",message_id="返回的id",account="work")
```

部分输出后EOF、错误帧或取消均不会被当完整成功。reasoning单独保存，不混进正文。Z.ai未在本项目实现可验证的GET流续接；“恢复”目前指查询/等待原消息与服务端状态，而非自动重放SSE。

## 签名

X-Signature按原前端双层HMAC计算：

```text
innerHex = HEX(HMAC_SHA256(key, floor(timestamp_ms/300000)))
signature = HEX(HMAC_SHA256(UTF8(innerHex), sortedPayload|base64_utf8(prompt)|timestamp_ms))
```

sortedPayload覆盖requestId/timestamp/user_id。查询指纹与签名时间一致，等待发送闸门后才签名。0.3.0曾使用raw内层key，本版更正；中文、长文本、时间窗口边界3个原函数固定向量一致。不宣称服务端当前一定严格验签。

## 验证码与资源上限

Node池默认2worker/3round不变，忙时有界FIFO等候，不空验证码裸发。失败/超时/取消会kill+Wait，坏worker可重建，Close等待清理；winner的loser也回收。共享的是固定进程预算，不承诺同一个验证码结果可以反复跨账户使用，每次发送现取。

| 资源 | 上限/策略 |
|---|---|
| 单消息输入 | 1MiB |
| 单SSE frame | 1MiB |
| SSE累计正文+reasoning | 4MiB |
| 通用JSON响应 | 16MiB |
| 文件inline | 1MiB |
| 流式上传/下载 | 256MiB |
| 消息batch | 每批100个id；单次最多2048条，累计JSON最多32MiB |

文件save_to写临时文件，成功close后原子替换；中断不覆盖原文件。ZIP请求没给save_to时，**HTTP前拒绝**。大文件不在内存里一次性拼接。会话历史仍依赖服务端完整结构，不保证无限历史全量读取。

内存占用与SDK运行、并发输出、HTTP响应相关，本版没有重新量测RSS，不报“恒定200MB”保证。

## Docker

单账户：

```bash
export ZAI_TOKEN="你的token"
docker compose up -d --build
```

多账户先准备项目目录下的真实 `accounts.json`，用可选编排覆盖：

```bash
docker compose -f docker-compose.yml -f docker-compose.accounts.yml up -d --build
```

或让AI客户端直接启动：

```json
{"command":"docker","args":["run","--rm","-i","--env-file","你的env文件","-v","captcha-cache:/home/bridge/.zcode-captcha-cdn-cache","-v","你的文件目录:/data","zai-bridge:0.3.1"]}
```

文件参数是容器路径，例如 `save_to=/data/result.zip`。Linux宿主需保证bind目录对容器bridge用户可写。使用compose的持久容器时，一个AI客户端用 `docker exec -i zai-bridge /app/zai-bridge`；避免多个exec各起进程误以为共享预算。

本轮Docker daemon未运行，未构建0.3.1镜像；已有latest可能是旧版。构建成功前不要声称容器已更新。

## 配置变量

| 变量 | 默认 | 意义 |
|---|---|---|
| ZAI_TOKEN | 空 | 单账户Bearer |
| ZAI_COOKIE | 空 | 单账户Cookie，多账户不继承 |
| ZAI_CONFIG | ~/.zai-bridge/config.json | 主配置文件 |
| ZAI_ACCOUNTS_FILE | ~/.zai-bridge/accounts.json | 多账户文件，显式路径必须存在 |
| ZAI_ACCOUNT | default或首账户 | 默认别名 |
| ZAI_MODEL | glm-5.3 | 模型 |
| ZAI_BASE_URL | https://chat.z.ai | HTTP基础地址 |
| ZAI_REGION | overseas | x-region |
| ZAI_SEND_INTERVAL | 8 | 秒，显式0仅关闭本地间隔，不解除上游限制 |
| ZAI_MAX_CONCURRENCY | 1 | 本账户并发上限1–64 |
| ZAI_CAPTCHA_WORKERS | 2 | 进程数量 |
| ZAI_CAPTCHA_ROUNDS | 3 | 求解轮数 |
| ZAI_NODE | node | Node路径 |
| ZAI_CAPTCHA_SCRIPT | 二进制旁captcha/solver.mjs | 求解入口 |
| ZAI_CAPTCHA_ENABLED | 1 | 关闭会明确走无预取模式，生产不建议 |
| CAPTCHA_STALL_MS | Docker10000 | SDK停滞阈值 |
| ZAI_DEBUG | 空 | 调试；本版不记录完整签名URL/凭证/消息体 |

## 离线验证与线上验证

```bash
go vet ./...
go test -count=1 ./...
go build -trimpath -ldflags="-s -w -X main.version=0.3.1" -o zai-bridge.exe ./cmd/zai-bridge
```

测试使用fake transport与Go helper子进程，不用真实token，不运行验证码SDK、不请求Z.ai。依赖首次下载属于构建网络，不是产品调用；严格离线可预备cache后设GOPROXY=off/GOSUMDB=off。Windows若测试exe被安全软件拦，使用已获授权的构建环境；不要混淆加壳。

`go test -race` 另行验证竞态。本轮Windows race runtime连零测试也报0xc0000139，**未通过race验收**。

[scripts/smoke.mjs](<./scripts/smoke.mjs>) 是真实线上测试：默认读接口也会访问Z.ai；`--write` 会真实发送和消耗额度，必须你明确允许。不在本轮执行。

## 限制

1. 依赖网页API和签名常量，前端升级可能失效。
2. 运行状态未知时保守阻止新发送，不自动取消云run或绕过额度。
3. 本地队列/预算不跨进程持久化、不与网页cloud queue同步；重启后重新查远端，未确认占位不会自动重发。
4. 确認未发送草稿仅限本进程或服务端保留bridge_draft标记；不猜测非本地占位。
5. 读取云沙箱代理的命令和输出不等于提供可任意执行命令的独立终端。
6. 不承诺绕过IP限流，也不自动根据会员名猜并发上限。

验证码部分来源 [TriDefender/zcode-api](https://github.com/TriDefender/zcode-api)，其CC-BY-NC-SA-4.0许可应保留并遵守。
