// eval-domain-cases.mjs — 全领域评测题库 (36 域 × 2-3 题 = 80 题)
// 设计原则: 每题踩中目标域触发词(planner.go domainTable), 且避开表序靠前域关键词截胡
// (例: ide-ext 题不能含 "python"/"git ", 否则 programming 域先截胡; drinks 题含
//  "recipe/ingredients" 无妨 — 表序 drinks 在 food 前, "cocktail" 先命中 drinks)
// expect: 标题+摘要的低配关键词命中检查(对齐 bench-gate 口径, 命中≠真解决)
export const CASES = [
  // ---- packages (3) ----
  { domain: "packages", q: "best npm package schema validation zod", expect: ["zod"] },
  { domain: "packages", q: "python 包 推荐 http 客户端 替代包", expect: ["http"] },
  { domain: "packages", q: "rust crate async runtime tokio", expect: ["tokio"] },
  // ---- devops (3) ----
  { domain: "devops", q: "postgres docker image official 推荐", expect: ["postgres"] },
  { domain: "devops", q: "helm chart kubernetes redis 部署", expect: ["helm", "redis"] },
  { domain: "devops", q: "ubuntu 20.04 停止维护 还支持吗 eol", expect: ["ubuntu"] },
  // ---- programming (3) ----
  { domain: "programming", q: "golang goroutine 泄漏 排查 pprof", expect: ["goroutine", "pprof"] },
  { domain: "programming", q: "python 正则 教程 贪婪匹配", expect: ["regex", "正则"] },
  { domain: "programming", q: "react useEffect cleanup 报错 修复", expect: ["useeffect"] },
  // ---- academic (3) ----
  { domain: "academic", q: "attention is all you need 论文 citation", expect: ["attention"] },
  { domain: "academic", q: "diffusion model survey paper 2024", expect: ["diffusion"] },
  { domain: "academic", q: "强化学习 综述 论文 arxiv", expect: ["强化学习", "reinforcement"] },
  // ---- ai-models (2) ----
  { domain: "ai-models", q: "huggingface bert 模型权重 下载", expect: ["bert"] },
  { domain: "ai-models", q: "open weights llm model download 2025", expect: ["weights", "model"] },
  // ---- entities (2) ----
  { domain: "entities", q: "华为 创始人 是谁", expect: ["任正非", "ren zhengfei", "zhengfei"] },
  { domain: "entities", q: "capital of Australia population", expect: ["canberra"] },
  // ---- geo (2) ----
  { domain: "geo", q: "西湖 在哪 位置 坐标", expect: ["西湖", "west lake", "hangzhou"] },
  { domain: "geo", q: "where is Eiffel Tower coordinates", expect: ["eiffel", "paris"] },
  // ---- quakes (2) ----
  // b14 expect 修正(评测报告 §4 复核): USGS 标题格式 "M 6.3 - 84 km SSW of ..." 天然不含
  // earthquake/地震 字样, 双题均为完美命中被误判 — 补 "m 6" 震级格式词(lower 后子串匹配)
  { domain: "quakes", q: "最近地震 最新震情", expect: ["地震", "earthquake", "m 6"] },
  { domain: "quakes", q: "recent earthquake magnitude 6", expect: ["earthquake", "m 6"] },
  // ---- images (2) ----
  { domain: "images", q: "富士山 可商用图片 stock photo", expect: ["fuji"] },
  { domain: "images", q: "galaxy nasa 太空照片 高清", expect: ["galaxy", "nasa"] },
  // ---- security (2) ----
  { domain: "security", q: "log4j CVE-2021-44228 vulnerability", expect: ["log4j"] },
  { domain: "security", q: "openssl 漏洞 安全公告 2024", expect: ["openssl"] },
  // ---- news (2) ----
  { domain: "news", q: "EU AI Act latest news 2026", expect: ["ai act"] },
  { domain: "news", q: "人工智能 最新消息 新闻 监管", expect: ["人工智能", "ai"] },
  // ---- dictionary (2) ----
  { domain: "dictionary", q: "ubiquitous meaning etymology", expect: ["ubiquitous", "latin"] },
  { domain: "dictionary", q: "鲲 什么意思 释义 词源", expect: ["鲲"] },
  // ---- chemistry (2) ----
  { domain: "chemistry", q: "caffeine molecular formula molar mass", expect: ["caffeine", "194"] },
  { domain: "chemistry", q: "咖啡因 分子式 分子量", expect: ["caffeine", "194"] },
  // ---- medical (2) ----
  { domain: "medical", q: "metformin randomized clinical trial", expect: ["metformin"] },
  { domain: "medical", q: "高血压 荟萃分析 系统综述 随机对照", expect: ["高血压", "hypertension"] },
  // ---- data (2) ----
  { domain: "data", q: "world bank open data gdp china", expect: ["gdp"] },
  { domain: "data", q: "各国 GDP 统计数据 开放数据", expect: ["gdp", "数据"] },
  // ---- weather (2) ----
  { domain: "weather", q: "Tokyo weather forecast 7 days", expect: ["tokyo"] },
  { domain: "weather", q: "北京 明天 天气 气温 降水", expect: ["北京"] },
  // ---- music (2) ----
  { domain: "music", q: "Bohemian Rhapsody album Queen recording", expect: ["bohemian", "queen"] },
  { domain: "music", q: "周杰伦 晴天 专辑 这首歌", expect: ["晴天", "周杰伦"] },
  // ---- space (2) ----
  { domain: "space", q: "SpaceX falcon 9 next rocket launch", expect: ["spacex", "falcon"] },
  { domain: "space", q: "长征五号 火箭 发射任务 计划", expect: ["长征", "cz-", "long march"] },
  // ---- browser-ext (2) ----
  { domain: "browser-ext", q: "firefox extension ad blocker addon", expect: ["ublock", "adblock", "block"] },
  { domain: "browser-ext", q: "firefox 扩展 广告拦截 推荐", expect: ["ublock", "adblock", "拦截"] },
  // ---- ide-ext (2) ----
  { domain: "ide-ext", q: "vscode extension markdown editor recommend", expect: ["markdown"] },
  { domain: "ide-ext", q: "jetbrains 插件 推荐 效率工具", expect: ["plugin", "插件"] },
  // ---- wordpress (2) ----
  { domain: "wordpress", q: "wordpress plugin seo best", expect: ["yoast", "seo"] },
  { domain: "wordpress", q: "woocommerce 插件 支付 网关", expect: ["woocommerce", "payment"] },
  // ---- tv (2) ----
  { domain: "tv", q: "breaking bad tv series seasons how many", expect: ["breaking bad"] },
  { domain: "tv", q: "权力的游戏 剧集 第几季", expect: ["权力", "game of thrones"] },
  // ---- podcast (2) ----
  { domain: "podcast", q: "best technology podcast 2025", expect: ["podcast"] },
  { domain: "podcast", q: "中文 播客推荐 科技 节目", expect: ["播客"] },
  // ---- games (2) ----
  { domain: "games", q: "best pc game deal on steam", expect: ["steam"] },
  { domain: "games", q: "steam 游戏 打折 买游戏", expect: ["steam"] },
  // ---- species (3) ----
  { domain: "species", q: "falcon taxonomy scientific name", expect: ["falcon"] },
  { domain: "species", q: "大熊猫 学名 分类学", expect: ["ailuropoda", "大熊猫", "giant panda"] },
  { domain: "species", q: "insulin protein amino acid sequence", expect: ["insulin"] },
  // ---- legal (2) ----
  { domain: "legal", q: "federal register privacy regulation", expect: ["federal", "privacy"] },
  { domain: "legal", q: "美国最高法院 判例 隐私权", expect: ["court", "判例"] },
  // ---- drug (2) ----
  { domain: "drug", q: "ibuprofen drug label dosage", expect: ["ibuprofen"] },
  { domain: "drug", q: "阿司匹林 适应症 剂量 药品说明书", expect: ["aspirin", "阿司匹林"] },
  // ---- finance (2) ----
  { domain: "finance", q: "bitcoin coin price today", expect: ["bitcoin", "btc"] },
  { domain: "finance", q: "美元 人民币 汇率换算", expect: ["usd", "cny", "美元", "人民币"] },
  // ---- drinks (2) ----
  { domain: "drinks", q: "mojito cocktail recipe ingredients", expect: ["mojito", "rum"] },
  { domain: "drinks", q: "玛格丽特 调酒配方 基酒", expect: ["margarita", "tequila", "玛格丽特"] },
  // ---- food (2) ----
  { domain: "food", q: "chicken tikka masala recipe", expect: ["chicken", "tikka"] },
  { domain: "food", q: "可乐 配料表 营养成分", expect: ["cola", "sugar", "糖"] },
  // ---- manga (2) ----
  { domain: "manga", q: "one piece manga latest chapter", expect: ["one piece"] },
  { domain: "manga", q: "葬送的芙莉莲 漫画 连载", expect: ["frieren", "芙莉莲"] },
  // ---- anime (2) ----
  { domain: "anime", q: "best anime 2024 recommendations", expect: ["anime"] },
  { domain: "anime", q: "进击的巨人 动漫 追番 推荐", expect: ["进击", "attack on titan", "巨人"] },
  // ---- sport (2) ----
  { domain: "sport", q: "NBA team lakers roster profile", expect: ["laker"] },
  { domain: "sport", q: "英超球队 曼联 球队资料", expect: ["manchester", "曼联"] },
  // ---- books (2) ----
  { domain: "books", q: "pride and prejudice public domain ebook", expect: ["austen", "pride"] },
  { domain: "books", q: "红楼梦 古典小说 名著 公版书", expect: ["红楼", "三国"] },
  // ---- travel (2) ----
  { domain: "travel", q: "things to do in Kyoto travel guide", expect: ["kyoto"] },
  { domain: "travel", q: "京都 旅行攻略 必去景点", expect: ["京都", "kyoto"] },
  // ---- lyrics (2) ----
  { domain: "lyrics", q: "晴天 歌词 周杰伦", expect: ["晴天", "周杰伦"] },
  { domain: "lyrics", q: "imagine john lennon lyrics", expect: ["imagine", "lennon"] },
];
