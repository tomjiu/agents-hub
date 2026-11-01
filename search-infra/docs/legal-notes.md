# 法律与合规说明

## 总原则

逆向分析的目的是**理解互操作性**,不是**复制代码**。

## 各目标 EULA 风险等级(初步判断)

| 目标 | EULA 类型 | 逆向条款 | 风险等级 | 备注 |
|---|---|---|---|---|
| Grok Build | Apache 2.0 | 允许 | 绿 | 直接读源码即可 |
| Codex | MIT | 允许 | 绿 | 直接读源码即可 |
| pi/dsh-search-boost | 自定义(MIT-like) | 允许 | 绿 | 自己的代码 |
| Open Deep Research | MIT | 允许 | 绿 | |
| Perplexica | MIT | 允许 | 绿 | |
| Trae (CN) | 闭源,需查 EULA | 多数禁止反编译 | 黄 | 仅供研究,不发布完整产物 |
| Qoder (CN) | 同上 | 黄 | 同上 |
| WorkBuddy | 同上 | 黄 | 同上 |
| Claude Code | Anthropic 商业条款 | 黄 | Anthropic 对研究态度较宽容,但完整反编译产物不要发布 |
| Antigravity | Google 商业条款 | 黄 | |
| TeleAgent | 中电信条款 | 黄 | |

## 安全做法

### ✅ 可以做

- 在本地解包并阅读代码
- 在报告中引用**短代码片段**(单段 ≤ 30 行)说明机制
- 在报告中描述架构、调用关系、数据流(文字 + 流程图)
- 引用公开文档、issue、博客
- 引用 LLM 输出的 system prompt(短)用于说明设计
- 把开源项目的代码原样拷贝并研究

### ❌ 不可以做

- 向仓库提交完整解包后的源码树
- 向仓库提交完整二进制 installer
- 向仓库提交任何看起来像凭据的字符串(即使是测试的)
- 在公开报告里原文发布完整的内部 system prompt(超过 200 字)
- 把某个工具的内部 endpoint / API 路径原文发布(用 `internal.endpoint.example` 替代)
- 基于反编译产物二次分发任何二进制
- 在报告里说"我们抄了 XXX 的代码"

## 仓库私有性的意义

仓库目前是 **private**,所以以下情况相对安全:

- 可以上传稍长的引用片段(但仍建议遵守 30 行上限)
- 可以记录内部 endpoint(但仍建议脱敏)
- 可以放反编译的中间产物(但单文件不超过 50 行,且放在 snippets/ 而不是 extracted/)

**但**:GitHub PAT 一旦泄漏,任何 private 内容都可能被公开。所以:

1. 报告里仍然按"已公开"标准写
2. 反编译产物永远不进 git,只放本地
3. 关键脱敏由 git filter 在 push 前再检查一遍

## 如果某个目标版权方提出异议

立刻:
1. 把对应 `analysis/<target>/` 目录从仓库删除
2. 在 `docs/takedown-log.md` 记录事件
3. 保留本地副本以备法律需要,但不再公开

## 引用规范

报告中引用代码片段时:

````
> 文件: `path/to/file.js:42-58`
> 用途: 说明 orchestrator 如何 dispatch search 工具

```javascript
// 短片段,≤30 行
function dispatchTool(name, args) {
  if (name === 'web_search') {
    return searchEngine.execute(args);
  }
  // ...
}
```
````

不引用:
- 整文件
- 整目录
- 任何文件名包含 `key` / `secret` / `token` / `password` 的内容
