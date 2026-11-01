# SearXNG 调度器/限流/超时 深挖精读（P1 / Task 12-a）

> 精读日期 2026-09-03，源码取自 GitHub master 分支（API + raw 实拉）。
> **范围声明**：按任务要求只看引擎调度/超时/熔断/限流四块（searx/search/、searx/enginelib/、searx/exceptions.py、botdetection/ip_limit.py），实例自保的 limiter/botdetection 安全全家桶只取实现思想不展开。

## 一、体检

| 项 | 值 |
|----|----|
| 仓库 | searxng/searxng（Python，Flask） |
| ★ / fork | 36,441 ★ / 3,327 fork |
| commits | 9,692（最后一条 2026-09-02：s1search 引擎换掉被 Cloudflare 挡的镜像） |
| 最后 push | 2026-09-02（体检前一天） |
| archived | 否；open issue 218 |
| **活死判断** | **非常活跃**——全球自建元搜索的事实标准，工程化程度大厂级（连"某引擎镜像被 CF 挡了"都会当天修） |

## 二、它是什么

元搜索引擎老祖：一次查询并行发给几十个上游引擎，聚合成一个无追踪的结果页。我们关心的不是它全家桶，而是它**怎么调度这几十个引擎**：per-engine 超时怎么算、引擎挂了怎么标记和恢复、结果怎么按 weight 打分、实例被刷怎么限流。这套代码跑了 8 年，是被验证过的调度器参考实现。

## 三、精读发现（源码级证据）

### 3.1 per-engine 超时与软截止（searx/search/__init__.py，209 行）

- **发请求前先查挂起表**（`_get_requests`，78-134 行）：`processor.extend_container_if_suspended(result_container)` 命中挂起 → 该引擎**根本不发请求**，直接在结果容器里记一条 unresponsive（suspended=True，带挂起原因）（abstract.py:235-241）。同样在此跳过的还有：不支持翻页/时间范围/max_page 超限的引擎（`get_params` 返回 None）。
- **超时取 max 再双重 min 封顶**（108-126 行）：
  ```
  default_timeout = max(所有选中引擎各自的 timeout)     // 每引擎 timeout 属性，默认 outgoing.request_timeout=3.0s
  actual_timeout = min 组合(default_timeout, 用户 query 的 timeout_limit, settings 的 max_request_timeout)
  ```
  四象限：都无→default；有用户值→min(default, user)；有全局 max→min(default, max)；都有→min(user, max)。**慢引擎可以放宽整轮截止，但被全局 cap 兜住；用户主动调低则收紧。**
- **线程弃置式软截止**（`search_multiple_requests`，136-158 行）：每引擎一个线程；主线程按 `remaining_time = actual_timeout - 已耗时` 逐个 `join(remaining_time)`；join 不动 → 线程标记 `_timeout=True` + 记 unresponsive('timeout')。**Python 线程杀不掉只能弃置**，迟到的腿回来后：`abstract.py extend_container`（220-233 行）检查 `threading.current_thread()._timeout` → 检测到弃置标记就直接报 timeout，**迟到结果一律作废**。
  - 对照我们：Promise.race+AbortController 是"真断"，SearXNG 是"标记+丢弃"——wall-clock 封顶+迟到腿作废的思想完全一致（我们 Task 11 落地的软截止正是这个），我们实现更彻底（AbortController 真能省资源）。

### 3.2 引擎挂起/熔断（abstract.py SuspendedStatus + exceptions.py + settings.yml）

- **状态三件套**（abstract.py:78-109）：`continuous_errors` 计数 + `suspend_end_time` + `suspend_reason`，threading.Lock 保护；`is_suspended = suspend_end_time >= now`。
- **挂起时长按异常类型显式分档**（settings.yml:69-77 `search.suspended_times`，实测原值）：
  | 异常 | 挂起时长 |
  |------|---------|
  | SearxEngineAccessDenied（402/403） | 180 s |
  | SearxEngineCaptcha | 3,600 s（1 小时） |
  | SearxEngineTooManyRequests（429） | 180 s |
  | **Cloudflare CAPTCHA** | **1,296,000 s（15 天！）** |
  | Cloudflare AccessDenied | 86,400 s（1 天） |
  | ReCAPTCHA | 604,800 s（7 天） |
  通用错误走 `ban_time_on_fail: 5` 起、`max_ban_time_on_fail: 120` 封顶（SuspendedStatus.suspend(None) 时 `min(max_ban, ban_fail)`，abstract.py:95-98）。**异常类型决定挂起档位，验证码类直接超长挂起。**
- **异常分类驱动**（online.py `search`，241-284 行）：SSLError / httpx.TimeoutException / HTTPError → `handle_exception(..., suspend=True)`；Captcha / TooManyRequests / AccessDenied → suspend=True；**其他普通 Exception → 只记录不挂起**（282-284 行）——普通解析错误不熔断，只有"上游不欢迎我"类错误才熔断。
- **挂起 key 是 network 不是引擎**（abstract.py:120-122）：`key = id(get_network(engine.name)) or engine.name` —— 共享同一代理/连接池配置的引擎**共享挂起状态**，挂的是"出口"而不是"引擎名"。
- **成功即 resume**（abstract.py:233）：成功路径调 `suspended_status.resume()` 清零计数和挂起时间。
  - 对照我们熔断 2.0：结构同构（分类阈值+恢复清零），差异在两点——①他们 per-异常显式秒数（且验证码档位重得多：我们 blocked 类 2×15min vs 他们 CF 验证码 15 天）；②他们挂 network 维度。

### 3.3 引擎权重与打分（enginelib weight + results.py calculate_score）

- weight 是引擎一级属性（`enginelib/__init__.py:351`，默认 1.0）；settings.yml 里 brave/dugout 等用 `weight: 2`，小众源 `weight: 0.5`。
- **打分公式**（results.py:17-36 `calculate_score`）：
  ```
  weight *= 引擎.weight × len(result.positions)     // positions = 命中该结果的引擎列表 → 共识=乘法加权
  位置 1：score += weight；其他位置：score += weight / position
  ```
  **共识加权他们早就有**（多引擎同结果直接乘权重倍数），与我们 fusion 的 `0.35×min(n-1,2)` 同思想；但他们是**无上限乘法**+`weight/position` 除法衰减（position 大时分数快速趋零）——对照我们的 RRF `Σ1/(k+rank)`（k=60 平滑），我们的排名位置权重更稳。
- 其他引擎默认属性（engines/__init__.py:36-57 `ENGINE_DEFAULT_ARGS`）：`enable_http: False`（**默认只许 HTTPS**）、`timeout` 默认取 outgoing.request_timeout、`disabled`（默认关但用户可开）与 `inactive`（彻底移除）双态、`display_error_messages: True`。引擎 init 在后台线程跑不阻塞主启动（abstract.py:124-150 `initialize`）。

### 3.4 限流实现（botdetection/ip_limit.py，148 行）——注意：是滑动窗口计数器，不是经典 token bucket

- 原话（文件头）：ip_limit 方法 "counts request from an IP in *sliding windows*"。底层是 Valkey（Redis 分叉）的 `incr_sliding_window(key, window)` / `drop_counter`。
- **实测常量**（ip_limit.py:61-89）：
  | 窗口 | 阈值 |
  |------|------|
  | BURST_WINDOW = 20 s | BURST_MAX = 15 次 |
  | 被判定 suspicious 后 | BURST_MAX_SUSPICIOUS = **2 次**、LONG_MAX_SUSPICIOUS = 10 |
  | API_WINDOW（format≠html 的 API 请求） | 独立窗口单独计数 |
  | SUSPICIOUS_IP_WINDOW = 30 天 | SUSPICIOUS_IP_MAX = 3 次 → 超了 429 BLOCK |
- **嫌疑升级机制**（110-124 行）：`link_token` 探测判定 suspicious → 该 IP 的窗口阈值**立即收紧到 2 次/20s**；一旦发出非可疑请求，`drop_counter` 释放嫌疑窗口。"可疑行为收紧额度"而非一刀切封禁。
- **定位要分清**：这套限流防的是"来访问 SearXNG 实例的人"（实例自保，防止实例被刷后自己被上游封），**不是对上游引擎的出站限速**。对上游的出站控制只有三样：per-engine `timeout`、per-engine 挂起表、发请求前查挂起表。我们要的出站限速（governor）他们反而没有专门机制。

## 四、它有我们没有的（对照 search-core v0.4：熔断 2.0/软截止/失败标注/额度门）

| # | 它有我们没有的 | 裁决 | 理由 |
|---|---------------|------|------|
| 1 | **异常类型→挂起秒数的显式映射表**（验证码类超长档：CF 验证码 15 天） | ✅ **值得抄** | 我们熔断 2.0 按类阈值（blocked 2×15min），对"Cloudflare 验证码"这类短期无解的失败太温和——白白浪费半开探针。给 blocked 类加"验证码特征→超长挂起（小时/天级）"一档 |
| 2 | **per-engine timeout 属性 + 全局 cap 的 min 组合** | ✅ **值得抄** | 我们 6s 软截止是全局一刀切；给 provider 加 timeout 属性（快引擎 3s 慢引擎 8s），整轮截止=各腿 max 但被全局 cap 封顶——mwmbl 1.7s 和 crossref 0.7s 的差异目前被我们一刀切抹平 |
| 3 | "嫌疑升级"式动态限速（suspicious→阈值收紧，正常→释放） | ✅ **值得抄思想** | 我们 DDG 限速门是固定 3s 间隔。可加两档状态机：连败窗口内收紧间隔/连续成功窗口放松——本质是我们熔断的对称面（熔断管"停"，这个管"减速"） |
| 4 | 挂起 key=network（共享出口一起挂） | ⏸ **暂不抄** | 我们单进程直连为主、无代理池；将来做代理池时挂起必须挂到出口维度（否则一个出口被封全池引擎陪葬） |
| 5 | weight 进打分 + 共识乘法 | ❌ **不抄** | 我们 RRF+共识加权已定版且更平滑（Task 10-c 论文对照过）；weight 思想可当 provider 静态先验，留作加权 RRF 实验分支的输入 |
| 6 | enable_http 默认关（HTTPS-only） | ❌ **不抄** | 我们池子里 http 端点几乎没有，安全模型不同 |
| 7 | disabled/inactive 双态 | ❌ **不抄** | 单开关+显式启用清单已够（我们 10 默认+显式池的划分更清晰） |
| 8 | Valkey 滑动窗口计数器本体 | ❌ **不抄** | 依赖外部存储；我们进程内限速门足够，分布式限流需求为零 |

## 五、裁决

**抄三件**：异常类型→挂起时长显式秒数表（重点补"验证码超长档"）、per-engine timeout 属性+全局 cap 的 min 组合、"嫌疑升级"动态限速思想（限速门两档化）。**不抄** weight/除法衰减打分（RRF 更好）和 Valkey 限流本体（那是给实例防爬的，我们是要出站限速，方向相反）。一句话：SearXNG 验证了我们熔断 2.0+软截止的方向对，但它 8 年沉淀的"分档秒数表"和"timeout 逐引擎差异化"这两处细节比我们糙版的更值得直接搬数字。
