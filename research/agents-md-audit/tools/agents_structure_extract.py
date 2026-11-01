#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AGENTS-EN.md 结构提取器
输出:
  1. 章节树(标题层级/行范围/字数/代码块)
  2. 全部祈使句指令(Do/Never/Always/Use...) 按行为类型分类
  3. 全部 shell 命令 / git 命令
  4. 全部提及的文件路径与目录
  5. 全部外部仓库引用
  6. 休眠触发器(条件激活指令)
"""
import json, re
import os
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.normpath(os.path.join(_HERE, ".."))
from collections import OrderedDict

SRC = os.path.join(_ROOT, "source", "AGENTS-EN.md")
OUT = os.path.join(_ROOT, "evidence", "structure-map.json")

text = open(SRC, encoding="utf-8").read()
lines = text.splitlines()

# ---------- 章节树 ----------
sections = []
stack = []  # (level, title, start)
for i, line in enumerate(lines):
    m = re.match(r"^(#{1,3})\s+(.*)", line)
    if m:
        level, title = len(m.group(1)), m.group(2).strip()
        sec = {"level": level, "title": title, "start_line": i+1, "parent": None}
        # 找父节点
        while stack and stack[-1][0] >= level:
            stack.pop()
        if stack:
            sec["parent"] = stack[-1][1]
        stack.append((level, title))
        sections.append(sec)

# 补充结束行和字数
for k, sec in enumerate(sections):
    sec["end_line"] = (sections[k+1]["start_line"] - 1) if k+1 < len(sections) else len(lines)
    body = "\n".join(lines[sec["start_line"]:sec["end_line"]])
    sec["words"] = len(body.split())
    sec["code_blocks"] = len(re.findall(r"^\s*```", body, re.M)) // 2

# ---------- 祈使句指令提取 ----------
# 匹配指令性语句: 句首为动词或 Never/Do not/Always/Prefer/Avoid/Use/When/Before/After/For/Pause only...
imperative_patterns = [
    r"(?m)^(Never|Do not|Don't|Always|Prefer|Avoid|Use|Pause|Commit|Push|Inspect|Read|Verify|Determine|Classify|Record|Update|Protect|Check|Fix|Test|Execute|Research|Do not restart|Do not assume|Do not claim|Do not write|Do not spread|Do not turn|Do not create|Do not silently|Do not add|Do not narrate|Do not invent|Do not replace|Do not degrade|Do not respond|Do not stop)\b[^.\n]*(?:\.[^.\n]*)*",
]

directive_re = re.compile(
    r"(?m)^\s*(?:[-*]\s+)?\**((?:Never|Do not|Don't|Always|Prefer|Avoid|Use|Pause only|"
    r"Commit only|Push when|Inspect|Verify|Determine|Classify the task|Record|Update|"
    r"Protect unrelated|Check|Fix meaningful|Test the path|Execute that entire|"
    r"Research if|Read its|Follow its|Reuse its|When (?:working|changing|analyzing|declaring),|"
    r"Before (?:doing|declaring|modifying|introducing|responding)|After (?:implementation|planning)|"
    r"If (?:a full|no suitable|real verification|an important|the environment|the conflict)\b[^,.]*)"
    r")\b[^.\n]*",
)

directives = []
for m in directive_re.finditer(text):
    line_no = text.count("\n", 0, m.start()) + 1
    directives.append({"line": line_no, "text": " ".join(m.group(0).split())[:200]})

# ---------- 行为分类 ----------
def classify(d):
    t = d.lower()
    cats = []
    if re.search(r"\b(git|commit|push|branch|remote)\b", t): cats.append("GIT")
    if re.search(r"\b(read|inspect|check|review|determine|verify|test|observe|reproduce|isolate)\b", t): cats.append("READ/VERIFY")
    if re.search(r"\b(write|create|update|record|persist|document|edit|implement|fix|add|maintain)\b", t): cats.append("WRITE")
    if re.search(r"\b(push|sync|remote|external|public|upload|install|download)\b", t): cats.append("NETWORK/EXTERNAL")
    if re.search(r"\b(approval|confirm|pause|permission|credential|destructive|irreversible)\b", t): cats.append("SAFETY-GATE")
    if re.search(r"\b(skill|agent|sub-agent|plugin|registry)\b", t): cats.append("SKILL/PLUGIN")
    return cats or ["GENERAL"]

cat_map = {}
for d in directives:
    for c in classify(d["text"]):
        cat_map.setdefault(c, []).append(d)

# ---------- shell/git 命令 ----------
shell_cmds = []
fence_re = re.compile(r"```([a-z]*)\s*\n(.*?)```", re.S)
for m in fence_re.finditer(text):
    lang, block = m.group(1), m.group(2)
    start = text.count("\n", 0, m.start(2)) + 1
    for cmd in block.splitlines():
        if cmd.strip():
            shell_cmds.append({"line": start, "lang": lang or "text", "cmd": cmd.strip()})

# ---------- 文件路径/目录 ----------
paths = sorted(set(re.findall(r"(?<![\w./])(?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]*\.?[A-Za-z0-9_-]*", text)))
paths = [p for p in paths if not p.startswith("http") and len(p) > 2 and re.search(r"[A-Za-z]", p)]

# ---------- 外部仓库 ----------
repos = sorted(set(re.findall(r"`([A-Za-z0-9_-]+/[A-Za-z0-9_.-]+)/?`", text)))

# ---------- 休眠触发器: 条件激活的指令 ----------
triggers = [
    {"condition": "新会话开始/上下文重置", "activates": "§4 工作恢复协议: 检查git状态→读指令→读持久状态→查提交→查代码→验证完成度→从已验证状态继续", "line_range": "106-123"},
    {"condition": "环境提供Skills/插件/代理", "activates": "§6 技能发现: 扫描7个技能目录+宿主注册表, 读取SKILL.md并遵循其契约", "line_range": "152-180"},
    {"condition": "环境无合适本地Skill", "activates": "§6 检查7个外部GitHub仓库并采用相关内容(供应链入口, 但要求检查后采用)", "line_range": "181-196"},
    {"condition": "构建/大幅修改前端", "activates": "§7 产品级前端工作流: 检查设计系统→识别主任务→参考商业产品→浏览器渲染验证", "line_range": "197-226"},
    {"condition": "无法完整实现时", "activates": "§9 必须停在真实边界并报告, 不得将降级版本标记为完成", "line_range": "281-300"},
    {"condition": "阶段计划已确立", "activates": "§10 YOLO整阶段连续执行, 不逐步确认(仅5种暂停条件)", "line_range": "301-330"},
    {"condition": "分析/重写现有产品", "activates": "§12 先研究现有实现→行为→架构→约束→测试→上游issue→权衡", "line_range": "354-383"},
    {"condition": "引入unsafe(Rust)", "activates": "§13 5项检查清单+最小边界+安全不变量文档化", "line_range": "384-423"},
    {"condition": "测试失败", "activates": "§16 观察→复现→隔离→假设→最小修改→验证", "line_range": "464-482"},
    {"condition": "有意义变更完成后", "activates": "§18 独立审查(可用子代理), 检查9类缺陷, 修复后重验证", "line_range": "526-555"},
    {"condition": "修改命令/API/架构/配置", "activates": "§19 同阶段更新持久文档, 不创建第二份竞争'真相'", "line_range": "556-577"},
    {"condition": "仓库交付需要远程同步", "activates": "§20 验证后push, 不得无证据声称push成功", "line_range": "578-605"},
    {"condition": "多阶段工作", "activates": "§21 维护紧凑持久状态文件, 阶段完成时提交前更新", "line_range": "606-629"},
    {"condition": "宣布阶段完成前", "activates": "§22 13项完成门检查清单", "line_range": "630-653"},
    {"condition": "工作完成", "activates": "§23 固定模板最终报告: Result/Changes/Skills/Verification/Review/Git/Status", "line_range": "654-687"},
]

report = OrderedDict()
report["sections"] = sections
report["directive_count"] = len(directives)
report["directives_by_category"] = {k: [d["text"] for d in v] for k, v in cat_map.items()}
report["directives_full"] = directives
report["shell_commands"] = shell_cmds
report["paths_mentioned"] = paths
report["external_repos"] = repos
report["dormant_triggers"] = triggers

import os
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=2)

print(f"章节树: {len(sections)} 个节点")
for s in sections:
    print(f"  {'  '*(s['level']-1)}[L{s['level']}] {s['title'][:70]}  (行{s['start_line']}-{s['end_line']}, {s['words']}词, {s['code_blocks']}代码块)")
print(f"\n指令句总数: {len(directives)}")
print("行为分类统计:")
for k, v in cat_map.items():
    print(f"  {k}: {len(v)} 条")
print(f"\nShell命令 {len(shell_cmds)} 条:")
for c in shell_cmds:
    print(f"  行{c['line']}: {c['cmd']}")
print(f"\n提及路径 {len(paths)} 个: {paths}")
print(f"\n外部仓库 {len(repos)} 个: {repos}")
print(f"\n休眠触发器 {len(triggers)} 个")
