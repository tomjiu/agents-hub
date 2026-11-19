# Skills 内容源

individual 按工程、文档、安全、研究分组；collections/vendors/trae 和 workbuddy 保留原始包结构与 Manifest。asset-management 是资产管理工作流；source-index查来源索引，skill-search查本地技能，repository-skills审核新增来源。

以 catalog/assets/*.toml 的稳定 ID 引用，不靠目录名区分同名厂商版本。独立 docx 和 trae.docx 是不同来源资产，不是同一个来源的部署副本；不得在 individual 与 collections 重复复制同一个来源。

当前123个canonical Skill已登记：individual 51、厂商71、asset-management 1。运行node asset-manager/cli.mjs search-assets "索引" --kind skills检索，skills-status检查全部登记/语法/重名；--verbose输出逐文件信息。10个原厂商name不符合通用客户端命名规范，库存保留但不是DSH可用保证。docx/pdf/pptx/xlsx/skill-creator有同名提供方，要用稳定ID选择。

Expert 引用能力，不复制文件。部署视图只是版本化输出，不作为维护源。厂商集合可能依赖原宿主工具和许可，默认不加载。
