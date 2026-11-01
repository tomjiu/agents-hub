# memory-net-console

> memory-net 云端控制台：经 Cloudflare Tunnel 远程浏览/操作家中主机的共享记忆网。
> 独立仓库，与 memory-net 解耦（vendor 钉扎构建产物，升级 = 换 sha 重拉）。

手机/任意浏览器打开一个域名（或局域网地址），填一次 token，即可：

- **浏览** 多个 workspace 的节点（约束/观测/推断/进度/提示），按类型/状态/关键词过滤
- **激活演示** 输入查询词与预算，实时看到 memory-net 的权重序裁剪（constraint 冻结置顶、token 预算、被裁计数）——auto-observe 观测质量的直观窗口
- **回放轨迹** run 列表与有序步骤（协作路径可复现/排障）
- **远程记录** 以宿主身份写 progress / trail——在外面看到的情况直接留进共享记忆网，家中 agent 下一次 activate 即可见

## 架构

```
apps/console      前端（vite + vanilla TS，零运行时依赖，构建产物 ~14KB）
packages/server   服务面（零依赖 TS：node:http + node:sqlite 只读探查 + 核心库语义面）
vendor/memory-net 钉扎的 memory-net 构建产物（入库，部署机零构建链）
scripts/fetch-vendor.sh  可复现拉取（改 MN_SHA → 重跑 → 全仓测试 → review diff）
scripts/ensure-e2e.sh    冒烟 server 幂等 ensure（端口探测 + 自动重启）
```

三道纪律（对齐 memory-net 哲学）：

1. **读面零写**：列表/统计/搜索用 node:sqlite 连接级只读（`readOnly` / `PRAGMA query_only`），SQL 层无任何写路径
2. **语义不复制**：activate / export / 受控写面一律经核心库（vendor 钉扎的 MemoryNet），权重序与预算裁剪语义唯一来源 = memory-net
3. **写纪律不破**：UI 写面仅 progress / trail（宿主合法操作）；observation 写路径仍仅工具桥/宿主可达，模型不可伪造

## 快速开始

要求 Node ≥ 22.13（node:sqlite 去 flag 的最低版本；22.5–22.12 需 --experimental-sqlite，开箱即崩，故不支持）。

```bash
npm install            # workspaces 安装（含 vendor file: 依赖）
npm run build          # server + console 双构建
npm test               # server 契约测试（node:test，零 LLM 依赖）

# 准备演示数据（或直接指向已有的 memory-net workspace 根目录）
node -e "
const {MemoryNet} = require('memory-net/dist/src/store.js');
const a = MemoryNet.open('/tmp/demo-ws', {agentId:'alice', role:'host'});
a.updateProgress('build-login', {status:'doing', summary:'登录页完成 60%'});
a.close();
"

# 启动（仅本地回环）
CONSOLE_HOME=/tmp CONSOLE_TOKEN=<你的token> node packages/server/bin/console.js

# 单域托管（前端 + API 同一端口，手机浏览器打开即用）
CONSOLE_HOME=/tmp CONSOLE_TOKEN=<你的token> \
  CONSOLE_STATIC=apps/console/dist node packages/server/bin/console.js
```

浏览器打开 `http://127.0.0.1:8790`（单域托管时默认端口 8790，示例用 8792），点右上 Token 填入即可。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `CONSOLE_HOST` | `127.0.0.1` | 红线：绝不 0.0.0.0；远程访问经 Tunnel/cloudflared 本机转发 |
| `CONSOLE_PORT` | `8790` | 监听端口 |
| `CONSOLE_TOKEN` | 随机生成打印一次 | Bearer token（sha256 对齐 + timingSafeEqual 常量时间校验） |
| `CONSOLE_HOME` | `~/.memory-net-console` | workspace 根（各 memory.db 的父目录；与 dsh 适配包 workspaceDir 同源即可） |
| `CONSOLE_STATIC` | （无） | 指向 `apps/console/dist` 开启单域托管 |
| `CONSOLE_LOG` | （关） | `=1` 打访问日志 |

## API 面（v1 / v1.1）

除 `/v1/health` 外全站 `Authorization: Bearer <token>` 强制（SSE 兼容 EventSource 额外接受 `?token=`）。

```
GET  /v1/health                      存活探针（免认证，非敏感）
GET  /v1/workspaces                  workspace 列表（发现 + 计数 + 最近活动）
GET  /v1/ws/:id/stats                画像：by_kind / by_status / by_agent / trail 汇总
GET  /v1/ws/:id/nodes                节点列表（kind/status/agent/q 过滤 + limit/offset 分页）
GET  /v1/ws/:id/nodes/:nid           单节点
GET  /v1/ws/:id/trail?run_id=        轨迹步骤
GET  /v1/ws/:id/runs                 run 摘要（步数/参与者/时间窗）
POST /v1/ws/:id/activate             激活演示 {query, budgets}（核心库权重序与预算语义）
GET  /v1/ws/:id/export               记忆包下载（备份/迁移/审计）
POST /v1/ws/:id/progress             受控写面：进度 {task_id, patch{status,summary,owner}}
POST /v1/ws/:id/trail                受控写面：轨迹 {run_id, action, refs?}
GET  /v1/events                      v1.1 实时事件流（SSE）：hello + workspace.updated
                                     ——本机写入即时广播；外部直写（家中 agent）经
                                     db/-wal/-shm mtime+size 签名轮询检测（默认 3s）
```

静态面：单域托管时 `/` 与非 `/v1/` 路径由 `CONSOLE_STATIC` 服务（SPA 深链接回退；URL 解码 + normalize + inside 双层防穿越；CSP 全响应头；`/assets/*` 内容哈希产物 `immutable` 缓存，入口 `no-store`）。

错误语义：动作已知但方法不对 → `405` + `Allow`；workspace 不存在 → `404`；库损坏/不可读 → `503 WORKSPACE_UNREADABLE`（`/v1/workspaces` 列表内以 `unreadable: true` 同步标记）。`/v1/health` 接受 `GET|HEAD`。

## Cloudflare Tunnel 接入（远程访问家中主机）

1. 家中主机：`cloudflared tunnel --url http://127.0.0.1:8790`（或配置文件方式，参考 kokoa-companion `docs/cloudflare-tunnel.md` 三步）
2. 手机浏览器打开 Tunnel 域名 → 填一次 `CONSOLE_TOKEN`
3. 完成——同一域名同时服务控制台界面与 `/v1/*` API

服务进程只绑 `127.0.0.1`：Tunnel 是唯一入口，token 是唯一凭证，记忆网对公网零暴露面。

## 明确不做（v1）

- 直接 SQL 写路径 / observation·constraint 的 UI 写面（仍仅宿主工具桥可达）
- 跨 workspace 聚合检索、向量相似度（memory-net 本就不是 RAG）
- SSE 实时推送（v1 手动刷新即可，留 v1.1 扩展）
- 多用户/权限分级（单 token 单家庭场景）

## 与其他仓的关系

- [`tomjiu/memory-net`](https://github.com/tomjiu/memory-net)：核心库与 dsh 适配包（vendor 钉扎来源，见 `.vendor-lock`）
- [`tomjiu/kokoa`](https://github.com/tomjiu/kokoa)：家中桌面主体；其 profile 内 dsh 运行时经适配包读写 memory-net——本控制台是同一张网的**人**侧窗口
- [`tomjiu/kokoa-companion`](https://github.com/tomjiu/kokoa-companion)：手机伴侣 App（消息/智能体控制）；本控制台补齐**记忆网**维度，三者共享同一部署哲学（Tunnel + 单域托管 + token）
