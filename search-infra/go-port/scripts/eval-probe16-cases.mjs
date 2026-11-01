// eval-probe16-cases.mjs — 批 16 泛化探针题库 (36 域 × 2 题 = 72 题, 全部为题库外新题)
// 目的: 检验 b7-b15 对既有 77 题题库调优后的【泛化能力】— 换实体/换措辞是否仍命中
// 设计原则:
//   1. 与 eval-domain-cases.mjs 无实体重叠(不同药物/城市/球队/词条/化合物)
//   2. 措辞口语化/多样化, 非原题关键词汤复制
//   3. 路由核对: 踩中 domainTable 触发词, 且避开表序靠前域词面截胡
//      (例: ide-ext 题不带 "python"/"git", ai-models 题不带 " paper", quakes 题靠表序先于 news)
//   4. expect 客观证据词(实体名/标准格式), 对齐 bench-gate 口径
export const CASES = [
  // ---- packages (2): pubdev 腿(flutter 信号) + npm 换实体 ----
  { domain: "packages", q: "flutter 状态管理 包推荐", expect: ["provider", "riverpod", "bloc", "flutter"] },
  { domain: "packages", q: "npm package date library recommendation", expect: ["date", "dayjs", "luxon", "moment"] },
  // ---- devops (2): 换镜像/换 eol 对象 ----
  { domain: "devops", q: "redis docker image official 推荐", expect: ["redis"] },
  { domain: "devops", q: "nodejs 18 还支持吗 eol", expect: ["node", "18"] },
  // ---- programming (2): 换语言换问题 ----
  { domain: "programming", q: "typescript 类型体操 教程", expect: ["typescript", "类型"] },
  { domain: "programming", q: "rust ownership borrow checker 报错", expect: ["ownership", "borrow"] },
  // ---- academic (2): 换论文/换主题; "蛋白质"词面被 academic(4) 先于 species(26) 截胡, 符合预期域 ----
  { domain: "academic", q: "transformer architecture original paper citation", expect: ["attention", "transformer"] },
  { domain: "academic", q: "蛋白质折叠 预测 论文 综述", expect: ["protein", "folding", "alphafold"] },
  // ---- ai-models (2): 换模型; 题面无 " paper" 防 academic 截胡 ----
  { domain: "ai-models", q: "llama 开源模型权重 下载", expect: ["llama"] },
  { domain: "ai-models", q: "stable diffusion model weights download", expect: ["stable", "diffusion"] },
  // ---- entities (2): 换实体; 特斯拉题 expect 对齐 wikidata P112 权威值(Eberhard/Tarpenning,
  //      马斯克是后期加入者不在 claims 内 — "创始人=马斯克"是流行误传, 产品直答 Eberhard 正确) ----
  { domain: "entities", q: "特斯拉 创始人 是谁", expect: ["eberhard", "艾伯哈德", "创始人"] },
  { domain: "entities", q: "population of Japan 2024", expect: ["japan", "日本"] },
  // ---- quakes (2): 表序 quakes(7) < news(11), "最新消息"不截胡 ----
  { domain: "quakes", q: "今天地震 最新消息", expect: ["地震", "earthquake", "m "] },
  { domain: "quakes", q: "latest earthquake magnitude 5 today", expect: ["earthquake", "m 5"] },
  // ---- geo (2): 换地标 ----
  { domain: "geo", q: "富士山 在哪 坐标", expect: ["富士山", "fuji", "35.3"] },
  { domain: "geo", q: "where is Statue of Liberty coordinates", expect: ["liberty", "new york", "40.6"] },
  // ---- images (2): 换主题 ----
  { domain: "images", q: "樱花 壁纸 可商用图片", expect: ["sakura", "cherry", "樱花"] },
  { domain: "images", q: "mars surface nasa 照片", expect: ["mars", "nasa"] },
  // ---- security (2): 换 CVE 对象 ----
  { domain: "security", q: "heartbleed cve 漏洞", expect: ["heartbleed", "cve-2014"] },
  { domain: "security", q: "struts 漏洞 安全公告 rce", expect: ["struts", "cve"] },
  // ---- news (2): 换主题 ----
  { domain: "news", q: "quantum computing breakthrough latest news", expect: ["quantum"] },
  { domain: "news", q: "新能源汽车 最新消息 新闻", expect: ["新能源", "汽车"] },
  // ---- dictionary (2): 换词条 ----
  { domain: "dictionary", q: "serendipity meaning etymology", expect: ["serendipity"] },
  { domain: "dictionary", q: "斟酌 什么意思 释义", expect: ["斟酌"] },
  // ---- chemistry (2): 换化合物 ----
  { domain: "chemistry", q: "glucose molecular formula molar mass", expect: ["glucose", "180"] },
  { domain: "chemistry", q: "乙醇 分子式 分子量", expect: ["ethanol", "46", "乙醇"] },
  // ---- medical (2): 换疾病 ----
  { domain: "medical", q: "aspirin cardiovascular prevention randomized trial", expect: ["aspirin"] },
  { domain: "medical", q: "糖尿病 随机对照 临床试验", expect: ["糖尿病", "diabetes"] },
  // ---- data (2): 换指标; 中文题避开 "人口"(entities 表序在前的触发词, 人口本就是实体问句) ----
  { domain: "data", q: "world bank open data population india", expect: ["population", "india"] },
  { domain: "data", q: "日本 gdp 统计年鉴 开放数据", expect: ["gdp", "japan", "日本"] },
  // ---- weather (2): 换城市 ----
  { domain: "weather", q: "Paris weather forecast tomorrow", expect: ["paris"] },
  { domain: "weather", q: "上海 今天 天气 湿度", expect: ["上海"] },
  // ---- lyrics (2): 换歌 ----
  { domain: "lyrics", q: "昨日重现 歌词", expect: ["yesterday", "carpenters", "昨日"] },
  { domain: "lyrics", q: "hey jude lyrics", expect: ["hey jude", "lennon", "jude"] },
  // ---- music (2): 换歌手/专辑 ----
  { domain: "music", q: "billie eilish new album 2024", expect: ["eilish", "album"] },
  { domain: "music", q: "林俊杰 江南 这首歌 专辑", expect: ["江南", "林俊杰"] },
  // ---- space (2): 换火箭 ----
  { domain: "space", q: "starship next launch window", expect: ["starship", "spacex"] },
  { domain: "space", q: "神舟 火箭 发射任务 计划", expect: ["神舟", "shenzhou"] },
  // ---- browser-ext (2): 换用途 ----
  { domain: "browser-ext", q: "firefox extension password manager addon", expect: ["password", "bitwarden", "keepass"] },
  { domain: "browser-ext", q: "firefox 扩展 翻译 推荐", expect: ["翻译", "translat"] },
  // ---- ide-ext (2): 题面禁带 "python"/"git "(programming 表序在前会截胡) ----
  { domain: "ide-ext", q: "vscode extension todo highlight", expect: ["todo"] },
  { domain: "ide-ext", q: "pycharm 插件 推荐 效率", expect: ["插件", "plugin"] },
  // ---- wordpress (2): 换用途 ----
  { domain: "wordpress", q: "wordpress plugin caching performance", expect: ["cache", "w3", "wp rocket"] },
  { domain: "wordpress", q: "wordpress 建站 主题 推荐", expect: ["theme", "主题"] },
  // ---- tv (2): 换剧 ----
  { domain: "tv", q: "stranger things tv series seasons", expect: ["stranger things"] },
  { domain: "tv", q: "琅琊榜 电视剧 哪部剧 好看", expect: ["琅琊榜", "nirvana"] },
  // ---- podcast (2): 换类型 ----
  { domain: "podcast", q: "best true crime podcast 2025", expect: ["crime", "podcast"] },
  { domain: "podcast", q: "英语学习 播客推荐 节目", expect: ["播客", "英语"] },
  // ---- games (2): 换品类 ----
  { domain: "games", q: "best indie game on steam", expect: ["indie", "steam"] },
  { domain: "games", q: "好玩的游戏 推荐 单机", expect: ["游戏"] },
  // ---- species (2): 换物种/换蛋白 ----
  { domain: "species", q: "blue whale taxonomy scientific name", expect: ["balaenoptera", "blue whale"] },
  { domain: "species", q: "hemoglobin protein amino acid sequence", expect: ["hemoglobin"] },
  // ---- legal (2): 换主题 ----
  { domain: "legal", q: "supreme court case law first amendment", expect: ["amendment", "court"] },
  { domain: "legal", q: "联邦公报 环境监管 法规 查询", expect: ["epa", "environment", "环境", "监管"] },
  // ---- drug (2): 换药 ----
  { domain: "drug", q: "amoxicillin drug label dosage", expect: ["amoxicillin"] },
  { domain: "drug", q: "对乙酰氨基酚 适应症 剂量 药品说明书", expect: ["paracetamol", "对乙酰氨基酚", "acetaminophen"] },
  // ---- finance (2): 换币 ----
  { domain: "finance", q: "ethereum coin price today", expect: ["ethereum", "eth"] },
  { domain: "finance", q: "欧元 美元 汇率换算", expect: ["eur", "usd", "欧元", "美元"] },
  // ---- drinks (2): 换酒 ----
  { domain: "drinks", q: "old fashioned cocktail recipe", expect: ["old fashioned", "bourbon"] },
  { domain: "drinks", q: "尼格罗尼 调酒配方 基酒", expect: ["negroni", "campari", "尼格罗尼"] },
  // ---- food (2): 换菜/换食品 ----
  { domain: "food", q: "pasta carbonara recipe ingredients", expect: ["carbonara", "pasta"] },
  { domain: "food", q: "巧克力 营养成分 配料表", expect: ["chocolate", "cocoa", "巧克力", "可可"] },
  // ---- manga (2): 换作品 ----
  { domain: "manga", q: "naruto manga volumes list", expect: ["naruto"] },
  { domain: "manga", q: "灌篮高手 漫画 连载", expect: ["slam dunk", "灌篮高手"] },
  // ---- anime (2): 换作品 ----
  { domain: "anime", q: "studio ghibli best anime movies", expect: ["ghibli", "anime"] },
  { domain: "anime", q: "鬼灭之刃 动漫 追番 推荐", expect: ["demon slayer", "鬼灭"] },
  // ---- sport (2): 换队 ----
  { domain: "sport", q: "nba team celtics roster profile", expect: ["celtic"] },
  { domain: "sport", q: "西甲球队 皇马 球队资料", expect: ["real madrid", "皇马", "madrid"] },
  // ---- books (2): 换书 ----
  { domain: "books", q: "jane eyre public domain ebook", expect: ["bronte", "jane eyre"] },
  { domain: "books", q: "西游记 古典小说 公版书", expect: ["西游记", "journey", "吴承恩"] },
  // ---- travel (2): 换城市 ----
  { domain: "travel", q: "things to do in Lisbon travel guide", expect: ["lisbon", "lisboa"] },
  { domain: "travel", q: "巴黎 旅行攻略 必去景点", expect: ["巴黎", "paris"] },
];
