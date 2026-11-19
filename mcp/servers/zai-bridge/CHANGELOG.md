# 更新记录

## 0.3.1（Z.ai安全与并发修复）
- X-Signature第二层密钥改为第一层HMAC的hex字符串，3个原前端固定向量一致。
- MCP新增8 worker / 64等待请求的有界并发、取消通知、initialize顺序及EOF drain；账户依赖每次调用独立快照。
- 配置不跨账户继承Cookie，显式路径/默认账户严格校验；相同token或JWT身份别名拒绝分配重复预算。
- 额度未知/耗尽拒绝发送，原子预留最后一份额度、同窗口不回补未知受理扣减，禁止跳过保护。
- 同会话FIFO+远端run终态才释放名额；默认账户并发1、上限64；实际POST共享出口闸门/Retry-After。
- 不再对网络错误/500/HTML/运行中或查不到自动重发；保留稳定message_id和partial，只有明确未受理CAPTCHA可受控重试。
- 验证码池保持默认2worker/3round，忙等待、取消/超时kill+Wait、故障恢复和幂等关闭。
- 文件流式上传/下载，inline1MiB/流式256MiB，ZIP无save_to时HTTP前拒绝，部分资源错误不丢失。
- 参数负值拒绝、UTF8裁剪、显式0、账号模型显示、等待remote终态与原子落盘修复。
- 本版仅离线fake transport/假求解进程测试；未重新发送消息或验证真实SDK、未消耗额度。Windows race runtime 0xc0000139尚未通过；Docker daemon未启动，旧镜像未更新。

> 以下历史描述按当时记录保留，不代表本版完成线上验收。特别是0.3.0“服务端接受”不能证明旧签名算法正确；0.2.4旧盲目重试已被替换。

## 0.3.0
- **X-Signature 请求头**：逆向出签名算法（HMAC-SHA256 双层，5 分钟窗口），
  密钥来自打包的 JS 常量。实测服务端接受
- **多账户支持**：`accounts.json`，每账户独立 token/限流器/额度缓存，
  验证码池全局共享（账户再多只占一份内存）
- **限流器重写**：改为「会话级串行 + 账户级可配置并发」。
  会话之间不共享沙盒/云盘/记忆，所以只需同会话串行；免费户并发 1，开会员可调高
- **额度预检**：发送前查当日额度，满了直接拒绝不发请求（免费户 20 次/天）
- **SSE 加固**：识别 HTML 错误页（网页端 SyntaxError 的根因）、
  行缓冲 4MB→16MB、流中断时明确报错而非静默返回空

## 0.2.5
- `get_messages` 支持 `leaf_id`，可查看重新生成产生的其它分支
- `get_chat` 显示分叉点（哪些节点下有多条候选回复）
- Makefile 增加 `ci` 目标：vet + 单测 + 构建，不联网、不需要 token

## 0.2.4
- `send_message` 支持 `attempts` 安全重试：失败后先确认上一轮是否已生成成功，
  避免重复发送；重试会换新消息 id（同 id 重发必 INTERNAL_ERROR）
- 新增 `list_models`

## 0.2.3
- 新增会话管理：`rename_chat` / `pin_chat` / `archive_chat` / `delete_chat`
- `delete_chat` 强制要求 `confirm=true`
- 冒烟测试自动清理自己创建的会话

## 0.2.2
- `list_chats` 支持 `search` 关键词搜索、`filter=archived/pinned`
- 新增 `list_tags`
- 修复搜索接口 `last_run` 为 null 时显示「无运行记录」与列表矛盾的问题

## 0.2.1
- 新增会话产物：`list_chat_files` / `download_chat_file`（含 zip 整包）
- 新增云盘删除 `delete_file`
- 澄清会话产物与云盘是两套存储

## 0.2.0
- 新增 `get_usage` / `list_files` / `download_file` / `upload_file`
- 修复 `get_chat` 运行状态恒为空（详情接口不返回 last_run）
- 会话 404 给出可操作提示

## 0.1.0
首个可用版本：
- 读：`list_chats` / `get_chat` / `get_messages`
- 写：`create_chat` / `send_message` / `wait_for_reply`
- 打通发送链路三个关键点：验证码预取、消息内容写入 history 节点、assistant 占位节点
