# RESTART — 环境清空后从这里满血复活

> 这个分析环境随时会被清空，**这个 GitHub 仓库是唯一的持久层**。
> 新会话开局：先读本文 + [PROGRESS.md](PROGRESS.md)，10 分钟内恢复全部战斗力。

---

## 一、30 秒搞懂这个仓库

- 我们逆向了 **14 个 AI 编程/研究工具**（4 个维度：agent 工作流 / 技能与工具市场 / 工具系统 / 搜索实现），出了一份横向对比。
- 基于分析成果写了 **search-core**（`core/` 目录）：免账号、免 API key 的搜索工具，TypeScript，v0.5 已完成（默认池 10 引擎 + key 插槽自动并联 + 时间机器双 provider + FTS5 缓存即搜索面，103/103 单测通过）。
- 三阶段进度：阶段一逆向 ✅ → 阶段二对比+规格 ✅ → **阶段三自研 🚧（v0.3 暂停中）**。
- 报告全部用大白话分层：易读层（`1-技能与工具市场/` `2-工作流与架构/` `3-搜索专题/`）+ 证据层（`reports/01-15`）。

## 二、恢复步骤（按顺序做）

```bash
# 1. clone 仓库
git clone https://github.com/mmqz/search-tool-rnd.git
cd search-tool-rnd
git config core.fileMode false   # 消除环境权限位的噪音 diff

# 2. 装工具链(用户态, 不需要 root, 见第三节)

# 3. 按需重新下载安装包(第四节地址总表 → raw-downloads/<target>/)
#    下载后先对 sha256(analysis/DOWNLOAD_SHA256.txt), 确认版本没变

# 4. 按"第五节 解包方法速查"解包

# 5. 读 PROGRESS.md 看停在哪, 接着干
```

不需要重新解包的情况：`analysis/*/notes/` 里已经留了关键证据（strings 提取、提示词明文、manifest、市场快照），只看结论的话直接读 `reports/`。

## 三、工具链重建命令（全部用户态）

```bash
# 7-Zip(解 NSIS/Inno 套娃 exe 必备), 装到 ~/.local/bin
mkdir -p ~/.local/bin && cd /tmp
curl -LO https://www.7-zip.org/a/7z2501-linux-x64.tar.xz
tar -xf 7z2501-linux-x64.tar.xz -C ~/.local/bin 7zz 7z.so
export PATH="$HOME/.local/bin:$PATH"

# @electron/asar(官方解包, 有的包它能解)
npm i -g @electron/asar

# 自写兜底提取器(官方 asar 解不开/缺参数时用, 已收进本仓库)
python3 scripts/asar_extract.py <包.asar> <输出目录> [只解哪些顶层目录(逗号分)] [排除目录(默认 node_modules)]
# 例: python3 scripts/asar_extract.py app.asar out/ dist,daimon-unpack

# deb 包
dpkg-deb -x xxx.deb out/

# JS 反混淆(可选)
npm i -g webcrack
```

历史教训：
- Trae 系列是 **Inno Setup 6.4**，老版 innoextract 不支持，直接用 7zz x 也能解。
- Claude Code 官网 exe 是 **stub 安装器**（Go 写的 Squirrel），里面没有程序本体；真正的 233M 完整包要从 stub 里挖出的下载协议拿（协议记录在 reports/08）。
- Kimi 是 **NSIS 四层套娃**：exe → app-64.7z → app.asar → daimon-bundle.tar.gz，一层层剥。
- 官方 `npx asar extract` 在某些包上报错/产出不完整时，`scripts/asar_extract.py` 实测可用（关键点：offset 是字符串，要 `int()` 转换）。

## 四、产品地址总表（14 个，全在这里）

> 版本号是当时分析的版本；同一 URL 官方一般持续发新版，sha256 对不上就说明上游更新了，机制分析通常仍然有效。

| # | 产品 | 分析版本 | 平台 | 获取方式 | 包类型 |
|---|------|---------|------|---------|--------|
| 1 | Grok Build | - | - | `git clone https://github.com/xai-org/grok-build` | 开源 |
| 2 | pi-search-boost | - | - | `git clone https://github.com/Mr-remon219/pi-search-boost` | 开源（自家） |
| 3 | dsh-search-boost | - | - | `git clone https://github.com/Mr-remon219/dsh-search-boost` | 开源（自家） |
| 4 | Open Deep Research | - | - | `git clone https://github.com/langchain-ai/open_deep_research` | 开源 |
| 5 | Perplexica | - | - | `git clone https://github.com/ItzCrazyKns/Perplexica` | 开源 |
| 6 | kimi-code（Kimi 桌面版内核，MIT） | commit b6144f9 附近 | - | `git clone https://github.com/MoonshotAI/kimi-code` | 开源 |
| 7 | Trae Work CN | 2.3.79533 | win32 | `https://lf-cdn.trae.com.cn/obj/trae-com-cn/pkg/app/releases/stable/2.3.79533/win32/TraeWork_CN-Setup-x64.exe` | Inno Setup |
| 8 | Trae Code CN | 2.3.78542 | win32 | `https://lf-cdn.trae.com.cn/obj/trae-com-cn/pkg/app/releases/stable/2.3.78542/win32/TraeCode_CN-Setup-x64.exe` | Inno Setup |
| 9 | Qoder CN | latest | linux | `https://qoder-app.oss-cn-beijing.aliyuncs.com/qoder-app/releases/latest/Qoder-CN-linux-amd64.deb` | deb |
| 10 | WorkBuddy | 5.4.2.36857725 | win32 | `https://codebuddy-1328495429.cos.accelerate.myqcloud.com/workbuddy/saas/win32-x64-user/WorkBuddy-win32-x64-user-5.4.2.36857725-d74591c4.exe` | NSIS |
| 11 | Claude Code | stub 1.40609.1 → full 1.44121.0 | win32 | stub：`https://downloads.claude.ai/releases/win32/x64/1.40609.1/ClaudeSetup-69aac03faa72b798ca63e9eb96057c1b2ade979e.exe`；完整包从 stub 内协议下载（reports/08） | Squirrel stub / NSIS full |
| 12 | Antigravity | 2.11.0 | linux | `https://storage.googleapis.com/antigravity-public/antigravity-hub/2.11.0-6376446768316416/linux-x64/Antigravity.tar.gz` | tar.gz |
| 13 | Kimi 桌面版 | 3.2.4 | win32 | `https://kimi-img.moonshot.cn/app/download/windows/kimi_3.2.4.exe` | NSIS 套娃 |
| 14 | ZCode | 3.10.2 | linux | `https://cdn-zcode.z.ai/zcode/electron/releases/3.10.2/linux-x64/ZCode-3.10.2-linux-x64.deb` | deb + asar |

附赠入口：
- ZCode 官方插件市场（在线 JSON）：`https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json`（快照已存 `analysis/zcode/notes/official-marketplace.json`）
- TeleAgent 链接（已按用户指示移出范围，备考）：`https://cdn01.teleai.com.cn/packages/2.4.1/TeleAgent-2.4.1-arm64.deb`
- 下载后的 sha256 对照：`analysis/DOWNLOAD_SHA256.txt`

## 五、解包方法速查（按包类型）

| 包类型 | 命令路径 | 用在谁身上 |
|--------|---------|-----------|
| Inno Setup exe | `7zz x Setup.exe` → 找 `resources/app.asar` → `python3 scripts/asar_extract.py` | Trae Work / Trae Code |
| NSIS exe | `7zz x Setup.exe` → 得 `app-64.7z` → `7zz x app-64.7z` → `resources/app.asar` → 提取 | WorkBuddy / Kimi |
| 套娃再加一层 | asar 里可能还有 tar.gz（如 Kimi 的 daimon-bundle.tar.gz），继续解 | Kimi |
| Squirrel stub exe | 用 strings 找下载 URL 协议 → curl 拿完整包 → 按 NSIS/full 处理 | Claude Code |
| deb | `dpkg-deb -x x.deb out/` → `resources/app.asar` → 提取 | Qoder / ZCode |
| tar.gz | `tar -xzf` 直接出 | Antigravity |
| Electron asar（通用） | 优先 `npx asar extract`；失败用 `python3 scripts/asar_extract.py` | 所有 |
| 混淆 JS bundle | 别追求还原变量名；`strings` / grep 关键词挖证据，必要时 webcrack | 全部闭源 |
| 开源 | git clone 直接读 | 表格 1-6 |

## 六、仓库地图（要找的东西在哪）

```
search-tool-rnd/
├── RESTART.md            ← 本文件(重启入口)
├── PROGRESS.md           ← 进度流水账(停在哪、下一步)
├── README.md             ← 项目总览 + 阅读导航
├── 1-技能与工具市场/      ← 易读层: 各家技能/工具/市场怎么管(按产品分文件)
├── 2-工作流与架构/        ← 易读层: agent 怎么组织(三流派+四定律)
├── 3-搜索专题/           ← 易读层: 各家搜索怎么做(本项目核心)
├── reports/01-15         ← 证据层: 15 份完整逆向报告
├── reports/13-cross-comparison.md ← 14 产品横向对比
├── design/v0-spec.md     ← search-core 设计规格
├── core/                 ← 自研 search-core 实现(v0.5, TypeScript, 默认池 10 引擎+key 插槽+时间机器+FTS5 缓存面, 103/103 单测)
│   └── README.md         ← 模块↔规格↔证据映射 + 已知限制
├── docs/targets.md       ← 目标清单+下载地址+状态(和本文第四节互为备份)
├── docs/methodology.md   ← 逆向方法论
├── docs/legal-notes.md   ← 合规边界
├── analysis/<target>/notes/ ← 关键证据快照(提示词明文/manifest/strings)
├── analysis/DOWNLOAD_SHA256.txt ← 下载包校验
└── scripts/              ← 工具脚本(asar_extract.py 在这)
```

## 七、当前停在哪（快照日期 2026-09-02）

- 15 份报告全部完成，最后 commit 见 `git log`（phase-g: Kimi + ZCode）。
- search-core v0.5 完成（v0.4 失败标注契约/熔断 2.0/软截止/key 插槽；v0.5 时间机器双 provider wayback+wikirev/FTS5 缓存即搜索面三出口）；下一批候选：SearXNG 异常→挂起秒数表搬进熔断 / provider 元数据拼进 MCP 工具描述(LDR) / Research Loop 查询带 goal+事实抽取硬约束(dzhng) / impers 传输层 feature-flag(v0.4 备胎) / 加权 RRF 实验分支 / LLM Planner。
- 下一阶段（用户已拍板方向）：**搜索工具专题分析**——分析市面上的搜索工具/搜索源，为 search-core 的 Provider 层选型和差异化做输入。

## 八、安全注意

- 本仓库 remote 里嵌着 GitHub PAT 明文，**每个阶段收尾都该考虑撤销重建**（GitHub Settings → Developer settings → Tokens）。
- 闭源软件的解包产物不进 git（.gitignore 已挡）；报告只引用短片段并标注研究用途，详见 `docs/legal-notes.md`。
