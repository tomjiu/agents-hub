# 目标清单 (Targets)

## 分类

### A. 开源 — 直接 clone 源码分析

| 目标 | 仓库 | 类型 | 优先级 | 状态 |
|---|---|---|---|---|
| Grok Build | https://github.com/xai-org/grok-build | Agent runtime + tool system + search runtime | P0 | ✅ reports/01 |
| Codex | https://github.com/openai/codex | CLI agent + tool calling | P0 | ✅ reports/09 |
| pi-search-boost | https://github.com/Mr-remon219/pi-search-boost | 搜索增强插件(自家) | P0 | ✅ reports/02 |
| dsh-search-boost | https://github.com/Mr-remon219/dsh-search-boost | 搜索增强插件(自家) | P0 | ✅ reports/10 |
| Open Deep Research | https://github.com/langchain-ai/open_deep_research | Research agent 参考 | P1 | ✅ reports/11 |
| Perplexica | https://github.com/ItzCrazyKns/Perplexica | 搜索引擎参考 | P1 | ✅ reports/12 |
| kimi-code (Kimi 桌面版内核) | https://github.com/MoonshotAI/kimi-code | MIT 开源, daemon 化后即 daimon | P0 | ✅ 直读, 见 reports/14 |

### B. 闭源 — 需要反编译

| 目标 | 下载链接 | 平台 | 类型 | 优先级 | 状态 |
|---|---|---|---|---|---|
| Trae Work CN | https://lf-cdn.trae.com.cn/obj/trae-com-cn/pkg/app/releases/stable/2.3.79533/win32/TraeWork_CN-Setup-x64.exe | win32 | AI 协作 IDE | P0 | ✅ reports/05 |
| Trae Code CN | https://lf-cdn.trae.com.cn/obj/trae-com-cn/pkg/app/releases/stable/2.3.78542/win32/TraeCode_CN-Setup-x64.exe | win32 | AI Code editor | P0 | ✅ reports/06 |
| Qoder CN | https://qoder-app.oss-cn-beijing.aliyuncs.com/qoder-app/releases/latest/Qoder-CN-linux-amd64.deb | linux | AI Code editor | P0 | ✅ reports/04 |
| WorkBuddy | https://codebuddy-1328495429.cos.accelerate.myqcloud.com/workbuddy/saas/win32-x64-user/WorkBuddy-win32-x64-user-5.4.2.36857725-d74591c4.exe | win32 | CodeBuddy 工作端 | P1 | ✅ reports/07 |
| Claude Code (Windows stub) | https://downloads.claude.ai/releases/win32/x64/1.40609.1/ClaudeSetup-69aac03faa72b798ca63e9eb96057c1b2ade979e.exe | win32 | Anthropic CLI | P0 | ✅ reports/08 (stub 里挖出下载协议拿到 1.44121.0 完整包, 见报告) |
| Antigravity | https://storage.googleapis.com/antigravity-public/antigravity-hub/2.11.0-6376446768316416/linux-x64/Antigravity.tar.gz | linux | Google Antigravity IDE | P1 | ✅ reports/03 |
| Kimi 桌面版 | https://kimi-img.moonshot.cn/app/download/windows/kimi_3.2.4.exe | win32 | Kimi Work 客户端 | P0 | ✅ reports/14 |
| ZCode | https://cdn-zcode.z.ai/zcode/electron/releases/3.10.2/linux-x64/ZCode-3.10.2-linux-x64.deb | linux(deb) | Claude Code fork (智谱) | P0 | ✅ reports/15 |
| ZCode 官方插件市场 | https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json | - | 在线 JSON | P0 | ✅ 已拉取快照 analysis/zcode/notes/official-marketplace.json |
| TeleAgent | https://cdn01.teleai.com.cn/packages/2.4.1/TeleAgent-2.4.1-arm64.deb | linux(deb) | 中电信 agent | - | ❌ 按用户指示移出范围(链接备考) |

### C. 半开源 / 部分公开

| 目标 | 链接 | 备注 |
|---|---|---|
| Grok CLI install script | `irm https://x.ai/cli/install.ps1 \| iex` | 安装脚本可能 fetch 闭源 binary,需要分析 install path |
| Grok Build hub | https://grok.com/build | 主站本身闭源,但 install 链接可拿 |
| Open-Grok | https://github.com/mweinbach/open-grok | Grok Build 衍生分支,辅助参考 |

## 下载策略

### 开源 (A 类)

直接 `git clone` 到 `analysis/<target>/source/`,**只读分析**,不修改。

### 闭源 (B 类)

1. 下载原始 installer 到 `raw-downloads/<target>/`(不进 git)
2. 识别 installer 类型:
   - `.exe`: NSIS / InnoSetup / Squirrel / 自解压
   - `.deb`: `dpkg-deb -x` 解开
   - `.tar.gz`: 直接解压
3. 如果是 Electron 应用:
   - 找 `app.asar` 或 `resources/app/`
   - 用 `npx asar extract` 提取
4. 如果是 webpack 打包的 JS:
   - 用 `webcrack` / `de4js` / `prettier` 反混淆
   - 不要试图完全恢复变量名,目标是理解结构
5. 如果是原生二进制:
   - 用 `strings` / `nm` / `objdump` 拿符号
   - 用 Ghidra / radare2 反汇编关键函数
   - 通常配合抓包/运行时 hook 比静态分析更有效

### 半开源 (C 类)

- install.ps1 直接 curl 下来读
- 抓 grok-build hub 的 install URL,下载 binary
- Open-Grok 直接 clone 当 cross-reference

## 优先级排序理由

P0 是**直接竞争对手**(都在做 AI coding agent + search),研究价值最高。
P1 是**辅助参考**或**研究类开源**。
P2 是**信息较少 / 体量小**,有空再看。
