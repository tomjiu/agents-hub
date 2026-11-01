# 逆向分析方法论

## 总原则

**目标是理解架构与机制,不是复刻代码。**
我们写的是研究报告,不是 fork。每份报告要让读者看完知道:
- 这个工具内部是怎么组织的
- 它的设计取舍是什么
- 我们能从中学到什么
- 哪些机制值得复制,哪些是它特有的 hack 不要照搬

## 工具链

### Electron / JS 应用(预计大多数 IDE 都是)

| 工具 | 用途 | 安装 |
|---|---|---|
| `@electron/asar` | 解 `app.asar` | `npm i -g @electron/asar` |
| `webcrack` | webpack bundle 反混淆 | `npm i -g webcrack` |
| `prettier` | 代码格式化(混淆后必看) | `npm i -g prettier` |
| `source-map-extractor` | 如果有 .map 直接恢复 | `npm i -g source-map-extractor` |
| `js-beautify` | 备选格式化 | `npm i -g js-beautify` |

### 二进制 installer

| �具 | 用途 |
|---|---|
| `binwalk` | 识别 firmware / 自解压格式 |
| `7z` | 解 NSIS / InnoSetup / Squirrel |
| `dpkg-deb` | 解 .deb |
| `innoextract` | 解 InnoSetup (.exe) |

### 原生二进制(少数情况)

| 工具 | 用途 |
|---|---|
| `strings` | 提取可见字符串(URL / API key / 硬编码 prompt) |
| `nm` / `objdump` | 符号表(通常 strip 过) |
| `radare2` / `rizin` | 反汇编 + 交叉引用 |
| Ghidra | 反编译伪代码(更可读) |
| `ltrace` / `strace` | 运行时系统调用追踪 |

### 抓包 / 运行时 hook

| 工具 | 用途 |
|---|---|
| `mitmproxy` | HTTPS 抓包(配 CA cert) |
| `frida` | 运行时函数 hook(看真实调用栈) |
| `ld_preload` 的小 libc patch | Linux 应用绕过 SSL pinning |
| `wombat` / `proxyman` | GUI 抓包 |

## 单目标分析流程(标准化 SOP)

每个目标按以下 7 步走,产出对应文件:

```
analysis/<target>/
├── 00-meta.md          # 元信息:版本/平台/下载日期/哈希
├── 01-structure.md     # 解包后目录结构
├── 02-entrypoint.md    # 主入口文件分析
├── 03-agent.md         # agent 工作流(核心)
├── 04-skills.md        # 技能仓库机制
├── 05-tools.md         # 工具系统 / 协议
├── 06-search.md        # 搜索实现(核心)
├── 07-context.md       # 上下文管理
├── 08-model-routing.md # 模型路由策略
├── 09-findings.md      # 综合发现
├── extracted/          # 解包结果(本地, .gitignore)
└── snippets/           # 关键代码短片段引用
```

### 00-meta.md 必填字段

- 原始下载链接
- 文件大小 + sha256
- 安装日期 / 分析日期
- 分析环境

### 01-structure.md

- 解包命令
- 完整目录树(限 3 层)
- 关键文件标注

### 02-entrypoint.md

- main 进程入口
- renderer 进程入口(Electron 的话)
- 启动参数 / 环境变量读取

### 03-agent.md(核心,字数最多)

回答这些问题:

1. **agent 拓扑**
   - 单 agent / planner-executor / 多 agent 编排?
   - 有没有 orchestrator?
   - agent 间通信用什么协议?(直接函数调用 / 消息队列 / 共享 state)

2. **决策点**
   - 什么时候调工具?是 prompt-driven 还是 state-machine-driven?
   - 什么时候停止?(round 上限 / LLM 自判 / 用户确认)
   - 失败重试策略?

3. **状态机**
   - 整个 agent loop 的伪代码
   - 关键状态转移
   - 异常分支

4. **prompt 架构**
   - system prompt 在哪?(代码硬编码 / 远程配置 / 用户可改)
   - few-shot 在哪?
   - 是否有 prompt 版本管理?

### 04-skills.md

- "技能" 这个概念在这个工具里叫什么?(可能是 "skill" / "rule" / "command" / "action")
- 注册方式(文件 / 代码 / 远程 manifest)
- 用户自定义入口(配置文件路径 / UI 入口)
- 是否支持第三方技能市场
- 调用方式(prompt 注入 / 代码 hook)

### 05-tools.md

- 工具协议
  - MCP?
  - 自定义 schema?
  - OpenAI function calling?
  - JSON-RPC?
- 工具签名怎么生成?(JSDoc / Schema / TypeScript 类型反射)
- 工具调用如何被授权?(用户确认 / 静默 / allowlist)
- 工具失败如何呈现给 LLM?

### 06-search.md(核心)

- 用了哪些搜索后端?(自家 / Brave / Tavily / Exa / DDG / SearXNG)
- query 改写?(LLM 重写 / 规则 / 无)
- 多引擎融合方式?(RRF / 加权 / 第一命中)
- 抓取策略?(全文 / 关键段落 / Readability)
- token 预算控制?
- 缓存策略?
- 主动式搜索 vs 被动调用的判断逻辑在哪?

### 07-context.md

- context window 怎么用?
- 截断策略?(滑窗 / 摘要 / LRU)
- 长期记忆?(向量库 / 文件 / 不持久)

### 08-model-routing.md

- 默认模型
- 不同任务路由策略
- 本地 vs 云端
- fallback

### 09-findings.md

- 这个工具最聪明的 3 个设计是什么?
- 最蠢的 3 个设计是什么?
- 我们能直接抄的机制是什么?
- 我们能避开它的什么坑?

## 报告写作要求

- 每个 markdown 文件最少 800 字(除非该维度真的不适用)
- 引用代码用 ```lang 代码块,标注文件路径
- **单个引用代码片段不超过 30 行**
- 引用片段必须配文字解释,不能贴完就走
- 必须包含至少一张 mermaid 流程图
- 不要写"该工具使用了先进的 agent 架构"这种空话,要写"在 src/agent/orchestrator.ts:142 处,当 LLM 返回 tool_use 块且 tool 名匹配 'web_search' 时,直接 dispatch 到 searchEngine 而不经过 planner,这个 dispatch 跳过 planner 的设计将搜索延迟从 ~80ms 降低到 ~20ms"

## 合规边界

- 不向仓库提交超过单文件 50 行的解包代码
- 不向仓库提交任何凭据 / token / API key(即使是测试用的)
- 不提交闭源软件的完整二进制
- 如果在反编译过程中发现未公开的 prompt / 内部 endpoint URL,在报告里用 `xxx` 脱敏,只说"该工具调用了一个内部 endpoint"即可
- 闭源目标的关键 prompt 可以引用(短),但完整 prompt 不要原样发布
