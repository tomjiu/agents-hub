# Cloud Vendors — 闭源软件云技能打包

> 从无公开云端仓库入口的闭源 AI 编程工具中提取的官方技能包。
> 提取方法：安装包逆向（strings / NSIS / asar 解包），详见
> [mmqz/search-tool-rnd](https://github.com/mmqz/search-tool-rnd)《1-技能与工具市场》报告。
> 全部为 **SKILL.md 兼容格式**（Claude Code 血统），可直接被 dsh / Kokoa / 任意
> 兼容 agent 的技能系统加载。

| 目录 | 产品 | 厂商 | 技能数 | 来源 |
|------|------|------|--------|------|
| [`trae/`](trae/) | Trae Work / Trae Code（TRAE SOLO） | 字节 | 23 | 云技能 CDN（p11-market.byteimg.com），下载 URL 从 ai_agent.dll strings 复原 |
| [`workbuddy/`](workbuddy/) | WorkBuddy 5.4.2 | 腾讯 CodeBuddy | 48 | 内置插件包（NSIS → app-64.7z → app.asar.unpacked），SHA256 校验过的官方安装包 |

## 用途

- 研究/互操作：了解闭源 agent 的技能工程（提示词结构、运行时契约、资产组织）
- 为 dsh / Kokoa 提供高质量技能素材（经 [kokoa skills-curator](https://github.com/mmqz/kokoa) 流水线筛选后加载）

## 许可与合规

这些内容提取自闭源软件的官方分发物，版权归原厂商所有。本目录仅用于研究、
学习与个人互操作用途；商用或再分发前请自行评估合规风险。每技能目录内
保留原包的 LICENSE（如含）。

## 目录结构

```
cloud-vendors/
├── trae/
│   ├── MANIFEST.json          # 23 技能 + 版本 + CDN 来源 URL
│   └── skills/<name>/         # 官方 zip 原样解包（SKILL.md + assets）
└── workbuddy/
    ├── curated-experts.json   # 60 个专家候选（场景匹配用）
    └── workbuddy-builtin/
        ├── skills/            # 20 个内置技能
        └── builtin-plugins/   # 5 个官方插件（排除平台二进制）
```

## 重新提取

- **Trae**：URL 模板 `…/skills/{channel}/trae_agent::{场景}::{构建号}::{技能名}/{版本}/package.zip`，
  构建号/场景枚举见 MANIFEST.json（可从新版 ai_agent.dll strings 刷新）
- **WorkBuddy**：官方安装包（URL 与 SHA256 见 search-tool-rnd/analysis/DOWNLOAD_SHA256.txt）
  → 7z 解 NSIS `$PLUGINSDIR/app-64.7z` → `resources/app.asar.unpacked/resources/plugins/`
