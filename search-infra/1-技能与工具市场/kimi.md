# Kimi 桌面版 · 技能与工具市场

> **一句话**：Kimi 桌面版的技能体系 = Claude Code 格式照单全收 + 一个"从对话和文档现场造技能"的用户界面 + 收编 OpenClaw 的 ClawHub 市场。工具面是全行业最宽的（约 30 个），从搜网页到配音配乐都管。

## 技能从哪来（四条路）

1. **内置托管技能**：daimon 里有 `SkillManage` 工具管着的技能目录，提示词里说"索引里的技能已预装在固定路径"。
2. **插件自带**：插件包里的技能在索引里标 `[plugin: <id>, path: ...]`，是**只读**的（SkillManage 不许改）——防止用户手贱改坏官方插件。
3. **用户现场造**：UI 里有两个入口——"Document to skills"（把手里的文档转成技能）和"chatCreateSkill"（把刚才对话里验证过的流程固化成技能）。**这是全行业唯一把"造技能"做成普通用户按钮的**，别人家都要手写 SKILL.md。
4. **ClawHub 市场**：通过收编 OpenClaw 生态，间接获得 ClawHub 上社区技能的分发能力（gateway.asar 里打包了 `openclaw 2026.3.13 + clawhub` CLI，UI 还有 MigrateOpenClawModal 迁移弹窗）。

## 技能加载规则（比 Claude Code 更狠）

Kimi 的系统提示词里明文写着：

- 先扫技能索引，**最多挑一个**最相关的调用，不许一次挂多个。
- **必须用 Skill 工具加载，禁止先用 read 工具去读 SKILL.md**。Claude Code 只是建议这么做，Kimi 写成了硬规则。
- 类型不对的技能（比如 reference 型）会拒载，这时才允许直接读文件。

## 工具系统：约 30 个，五大类

| 类别 | 工具 | 备注 |
|------|------|------|
| 文件/执行 | read_file、edit_file、write_file、shell、ipython | ipython 独立成工具 |
| 浏览器（9 个） | browser_visit / click / input / find / state / screenshot / scroll_up / scroll_down + 整页截图 | 载体是 **Chrome 扩展（Kimi WebBridge）**，用 debugger API 控制用户日常浏览器 |
| 搜索 | web_search、image_search、search_image_by_text/image、fetch_urls | **服务端执行**——开源的 kimi-code 仓库里根本没有这几个工具的实现 |
| 生成/部署 | generate_image、generate_speech、generate_sound_effects、deploy_website、slides_generator | 生成图片+语音+音效+部署网站，桌面助理的全家桶 |
| Agent 级 | create_subagent、k2_think、memory_space | 子代理、K2 模型深度思考、记忆空间 |

工具全集是从 UI 语言包里挖出来的（每个工具都有"运行中/出错"的多语言文案）——这是个实用的逆向技巧：**语言包不混淆，还自带工具清单**。

## 托管 Python 运行时：技能的执行底座

系统提示词里直接列了包清单：pandas / matplotlib / seaborn / duckdb / reportlab / python-docx / python-pptx / yfinance + **捆绑中文字体**，还内置 `daimon_runtime.setup_plot()` 解决画图中文字体乱码。模型不用猜环境里有什么，技能执行不会翻车——**文档类技能能稳定的真正原因在这**。

## 值得抄的清单

1. **"从对话造技能"的产品化**：验证过的流程一键固化成技能，普通人也能攒私房技能。
2. **插件技能只读**：官方插件不许用户改，升级不受污染。
3. **托管运行时 + 提示词联动**：环境里有什么包，直接写在提示词里告诉模型。
4. **语言包逆向法**：找工具清单先翻 locale 文件，成本最低。

## 证据指路

硬核细节见 `reports/14-kimi-desktop.md`（第 3、4、7 节）。原始解包在 `raw-downloads/kimi-app/`，系统提示词明文在 `daimon-unpack/app/daimon/dist/src/core/runtime/system-prompt/prompts/`。
