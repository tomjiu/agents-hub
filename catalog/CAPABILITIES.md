# 按任务找能力

本页由 [任务目录元数据](<capabilities.json>) 生成。它是精选任务目录，不是全部资产分类，也不是已安装工具列表。

## 怎样选择

先看任务范围，再用CLI读取当前正文匹配、来源、许可和宿主障碍。主选/辅助/备选不是共同安装配方。

~~~sh
node asset-manager/cli.mjs find-capability "需求分析与规划"
node asset-manager/cli.mjs find-capability "办公质量验收"
node asset-manager/cli.mjs capabilities --group office
~~~

scoped表示限定任务范围，partial表示部分覆盖，none表示缺口。CURRENT仅表示已审阅正文哈希一致，不是专业效果、许可或运行验收；CONTENT_READY也只表示内容可读。未知查询返回NO_MATCH，可另用search-assets查库存，不自动回退碎片匹配。

## 办公工作

### 需求分析与任务规划（requirements-planning）

范围：partial；领域：workflow / document；阶段：plan.

任务用语：需求分析与规划、需求分析、任务规划、requirements planning.
- 工程实施计划可以复用拆解方法；未覆盖通用业务访谈、成本评估和办公排期验收。

- [writing-plans](<assets/writing-plans.toml>)（primary）；[维护正文](<../skills/individual/engineering/writing-plans/SKILL.md>)。来源类型：local；许可声明：review-required.
  - 适用理由：已有需求到分步骤实施计划，偏软件工程。
  - 限制：需要已明确的需求；代码测试与worktree步骤不适用于所有办公任务。

- [doc-coauthoring](<assets/doc-coauthoring.toml>)（supporting）；[维护正文](<../skills/individual/document/doc-coauthoring/SKILL.md>)。来源类型：local；许可声明：review-required.
  - 适用理由：提案/PRD协作补充受众、背景及结构整理。
  - 限制：文档协作而非项目管理；独立读者测试受宿主与用户授权限制。

### 按已审查计划执行（task-execution）

范围：partial；领域：workflow；阶段：execute.

任务用语：任务执行、执行计划、task execution.
- 只提供计划执行纪律，不能代替具体业务工具、授权和产物验收。

- [executing-plans](<assets/executing-plans.toml>)（primary）；[维护正文](<../skills/individual/engineering/executing-plans/SKILL.md>)。来源类型：local；许可声明：review-required.
  - 适用理由：已有计划的逐项执行与检查点。
  - 限制：内容偏开发分支工作流；未注册子技能不可假定存在，不自动派生代理。

### 质量验收与交付核验（quality-acceptance）

范围：partial；领域：workflow；阶段：accept.

任务用语：办公质量验收、质量验收、交付核验、quality acceptance.
- 复用证据先于完成声明的原则；没有通用办公产物评分量表或业务审批流程。

- [verification-before-completion](<assets/verification-before-completion.toml>)（primary）；[维护正文](<../skills/individual/engineering/verification-before-completion/SKILL.md>)。来源类型：local；许可声明：review-required.
  - 适用理由：检查完成声明是否有新鲜验证证据。
  - 限制：不是Word排版、PPT视觉或Excel公式完整验收方案。

### Word文档（word-document）

范围：scoped；领域：document；阶段：execute.

任务用语：Word文档、word document、DOCX.
- 许可声明限制；只有显式许可复核与运行审核后才考虑采用。

- [docx](<assets/docx.toml>)（primary）；[维护正文](<../skills/individual/document/docx/SKILL.md>)。来源类型：local；许可声明：proprietary-restricted-declared.
  - 适用理由：按现有技能描述处理对应文档文件。
  - 限制：许可声明限制；只有显式许可复核与运行审核后才考虑采用。

### PPT制作（pptx-work）

范围：scoped；领域：document；阶段：execute.

任务用语：PPT制作、制作PPT、PowerPoint、PPTX.
- PPTX制作参考不等于可默认部署；许可与渲染环境仍受限。

- [pptx](<assets/pptx.toml>)（primary）；[维护正文](<../skills/individual/document/pptx/SKILL.md>)。来源类型：local；许可声明：proprietary-restricted-declared.
  - 适用理由：按现有技能描述处理对应文档文件。
  - 限制：PPTX制作参考不等于可默认部署；许可与渲染环境仍受限。

### Excel数据处理（xlsx-work）

范围：scoped；领域：document；阶段：execute.

任务用语：Excel数据处理、Excel表格、XLSX.
- 只覆盖以表格文件为主要产物，非通用数据库/金融结论保证。

- [xlsx](<assets/xlsx.toml>)（primary）；[维护正文](<../skills/individual/document/xlsx/SKILL.md>)。来源类型：local；许可声明：proprietary-restricted-declared.
  - 适用理由：按现有技能描述处理对应文档文件。
  - 限制：只覆盖以表格文件为主要产物，非通用数据库/金融结论保证。

### PDF处理（pdf-work）

范围：scoped；领域：document；阶段：execute.

任务用语：PDF处理、PDF文件、PDF.
- 处理/OCR依赖需另验，既有许可限制不绕过。

- [pdf](<assets/pdf.toml>)（primary）；[维护正文](<../skills/individual/document/pdf/SKILL.md>)。来源类型：local；许可声明：proprietary-restricted-declared.
  - 适用理由：按现有技能描述处理对应文档文件。
  - 限制：处理/OCR依赖需另验，既有许可限制不绕过。

### 业务排期与资源预算（business-scheduling）

范围：none；领域：workflow；阶段：plan.

任务用语：业务排期、资源预算、business scheduling.
- 当前未建立经审查的专用工作流；不以工程计划技能冒充业务管理能力。
- **未建立经审阅的专用能力，不自动推荐相似资产。**

## 设计工作

### UI设计与前端视觉实现（ui-design）

范围：scoped；领域：design / engineering；阶段：design / execute.

任务用语：UI设计、UI 设计、界面设计、frontend design.
- 前端视觉代码与厂商画布是不同产物/宿主；提供方是备选，不应全部混装。

- [frontend-design](<assets/frontend-design.toml>)（primary）；[维护正文](<../skills/individual/document/frontend-design/SKILL.md>)。来源类型：local；许可声明：Apache-2.0.
  - 适用理由：独立技能生成视觉风格明确的前端代码。
  - 限制：不是Ardot画布工作流；无专业设计效果认证。

- [workbuddy.ardot-ui-design](<assets/workbuddy.ardot-ui-design.toml>)（alternative）；[维护正文](<../skills/collections/vendors/workbuddy/workbuddy-builtin/skills/ardot-ui-design/SKILL.md>)。来源类型：workbuddy-installer；许可声明：vendor-restricted.
  - 适用理由：Ardot画布UI/组件/设计系统领域指导。
  - 限制：需要Ardot画布、注入的ardot-design-core及原宿主；默认不可由模型调用，许可/宿主待审。

- [trae.solo-design](<assets/trae.solo-design.toml>)（alternative）；[维护正文](<../skills/collections/vendors/trae/skills/solo-design/SKILL.md>)。来源类型：trae-cdn；许可声明：vendor-restricted.
  - 适用理由：Trae原包的设计分路与画布工作流参考。
  - 限制：依赖原设计工具/多代理流程与验证脚本，不是DSH可移植通用实现。

### 设计系统与组件规范（design-system）

范围：partial；领域：design；阶段：design.

任务用语：设计系统、组件库规范、design system.
- 只有候选画布领域指导；未建立可直接用于DSH的完整设计系统生产能力。

- [workbuddy.ardot-ui-design](<assets/workbuddy.ardot-ui-design.toml>)（alternative）；[维护正文](<../skills/collections/vendors/workbuddy/workbuddy-builtin/skills/ardot-ui-design/SKILL.md>)。来源类型：workbuddy-installer；许可声明：vendor-restricted.
  - 适用理由：正文明确涵盖design tokens和组件库。
  - 限制：依赖ardot-design-core和原画布，禁止作为独立默认部署能力。

## 工程开发

### Web应用自动化测试（webapp-testing）

范围：scoped；领域：engineering；阶段：test.

任务用语：自动化测试、Web应用测试、webapp testing、web application testing.
- 测试本地应用，不等同一般网页操作；具体用例和应用身份仍需检查。

- [webapp-testing](<assets/webapp-testing.toml>)（primary）；[维护正文](<../skills/individual/document/webapp-testing/SKILL.md>)。来源类型：local；许可声明：Apache-2.0.
  - 适用理由：Python Playwright测试本地应用，含受控server生命周期。
  - 限制：需要Python/Playwright/浏览器；TCP就绪不等于应用健康，不接管已运行服务。

### 浏览器自动化操作（browser-automation）

范围：scoped；领域：engineering；阶段：execute / test.

任务用语：浏览器自动化、浏览器操作、browser automation、playwright cli.
- CLI优先的交互操作，不自动改成测试套件或接管用户浏览器。

- [playwright](<assets/playwright.toml>)（primary）；[维护正文](<../skills/individual/engineering/playwright/SKILL.md>)。来源类型：local；许可声明：Apache-2.0.
  - 适用理由：终端驱动真实浏览器导航/填写/截图。
  - 限制：原入口含Codex路径与npx工具，DSH需显式工具/路径适配；存在不代表已安装。

## 研究工作

### 资料搜索与调研（information-research）

范围：scoped；领域：research；阶段：research.

任务用语：资料搜索、深度调研、互联网搜索、information research.
- 只指搜索与研究操作说明；实际MCP mcp.search-core需另外构建和明确加载。

- [search-core](<assets/search-core.toml>)（primary）；[维护正文](<../skills/individual/research/search-core/SKILL.md>)。来源类型：local；许可声明：review-required.
  - 适用理由：说明搜索、研究与focused fetch的已有入口。
  - 限制：词法候选不是事实/最新版本认证；工具与网络能力必须实际验证。

## 安全工作

### 代码安全威胁建模（threat-model）

范围：scoped；领域：security；阶段：research.

任务用语：威胁建模、threat model.
- 仅针对显式请求的代码库安全分析，不用于普通UI设计或架构摘要。

- [security-threat-model](<assets/security-threat-model.toml>)（primary）；[维护正文](<../skills/individual/security/security-threat-model/SKILL.md>)。来源类型：local；许可声明：Apache-2.0.
  - 适用理由：正文定义信任边界、攻击面与缓解措施。
  - 限制：需要代码范围与证据，不保证安全认证或所有语言/运行时覆盖。

## 覆盖边界

当前 14 条任务路线，映射 15 个不同Skill资产；122 项登记资产尚未进入此精选目录（含MCP/插件/规范）。不新增重复Skill，不改变资产ID、原始目录、Experts、许可或运行配置。

原Skill正文或有效版本变化需要重新审阅任务映射，不能盲目重算哈希。正文之外的脚本/参考材料仍需原资产完整性与使用前预检；本目录不是内容快照锁或自动部署许可。
