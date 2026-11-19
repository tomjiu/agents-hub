# WorkBuddy 内置技能与插件（48 个 SKILL.md）

提取自腾讯 WorkBuddy 5.4.2（`@genie/workbuddy-desktop`）官方 Windows 安装包
（SHA256 校验通过，值见 search-tool-rnd/analysis/DOWNLOAD_SHA256.txt）。
解包链：NSIS → `$PLUGINSDIR/app-64.7z` → `resources/app.asar.unpacked/resources/plugins/`。

- `workbuddy-builtin/skills/`：20 个内置技能（skill-creator、expert-manager、
  ardot-* 设计族 6 个、buddy-multimodal-generation、sites、library、
  tencent-docs-routing、wb-finance-skill 等）
- `workbuddy-builtin/builtin-plugins/`：5 个官方插件（tencent-docx 大型文档 agent、
  sheetagent、tencent-pptx、tencent-docs-plugin、weixinpay；已排除平台预编译二进制）
- `curated-experts.json`：60 个专家候选（场景 → 专家匹配）

格式：Claude Code SKILL.md 兼容（`.codebuddy-plugin/plugin.json` 清单）。
版权：腾讯。仅研究/互作用途。
