package main

// 域名路由表 v0.6 + 查询 Planner (逐字对齐 TS domains.ts + planner.ts)
// 思想: 通用引擎撒大网, 域名表指定鱼塘; Tier1 免 key API 直连 / Tier2 site: 交给通用引擎 / Tier3 通用池兜底。
// 表序即优先级: packages/devops 窄词必须先判(防 programming 宽词截胡)。

import (
	"fmt"
	"regexp"
	"strings"
)

type domainTopic struct {
	apiProviders []string
	siteTargets  []string
	siteEngines  []string
	keywords     []string
}

// 种子表(2026-09-03, 13 领域; 与 TS DOMAIN_TABLE 逐条对齐; 未移植 provider 由 runLanes 跳过不塌方)
var domainTable = map[string]domainTopic{
	"packages": {
		// 探针第 12 批域加强: pubdev(dart/flutter)
		apiProviders: []string{"npm", "crates", "packagist", "rubygems", "pypi", "metacpan", "repology", "nuget", "hex", "pubdev"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"npm 包", "npm package", "best npm", "crates.io", "rust crate", "cargo 依赖", "cargo 包",
			"packagist", "composer 包", "php 包", "rubygems", "ruby gem", "哪个包", "包推荐", "替代包",
			"包管理器", "package manager", "library recommendation", "库推荐",
			"pypi", "pip 包", "python 包",
		},
	},
	"devops": {
		apiProviders: []string{"dockerhub", "flathub", "arch", "artifacthub", "snapcraft", "endoflife"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"docker 镜像", "容器镜像", "docker image", "container image", "官方镜像",
			"docker hub", "镜像推荐", "哪个镜像", "base image",
			"flatpak", "linux 应用",
			"arch linux", "archlinux", "pacman", "arch 包",
			"helm chart", "helm", "kubernetes chart", "chart 仓库", "opa policy",
			// 探针第 10 批域加强: snapcraft(snap 包)
			"snap 包", "snapcraft", "snap install",
			// 探针第 11 批域加强: endoflife(版本 EOL; " eol "/" lts " 空格锚定防裸子串误伤 results/salt)
			" eol ", "end of life", "endoflife", "生命周期", "停止维护", "停止支持", "版本支持", " lts ", "还支持",
		},
	},
	"programming": {
		apiProviders: []string{"stackexchange", "github", "hn", "keenable", "mdn"},
		siteTargets:  []string{"docs.python.org"},
		siteEngines:  []string{"duckduckgo", "bingrss"},
		keywords: []string{
			"python", "javascript", "typescript", "nodejs", "node.js", " npm ", "react", "vue",
			"rust ", "rust-", "golang", " golang", "java ", "kotlin", "swift", "c++", "c#",
			"css", "html", "sql", "regex", "正则", "async", "docker", "kubernetes", "git ",
			"报错", "编译错误", "运行报错", "error:", "exception", "stack trace", "堆栈",
			"修复", "debug", "how to fix", "api 调用", "库推荐", "教程", "tutorial",
			"安装依赖", "dependency", "pip install", "npm install", "配置文件", "语法",
		},
	},
	"academic": {
		// 探针第 12 批域加强: openreview(CS/ML 会议评审与 DBLP 记录, 中文词面可用)
		apiProviders: []string{"arxiv", "crossref", "openalex", "dblp", "pubmed", "wikipedia", "hfpapers", "zenodo", "doaj", "openaire", "inspirehep", "openreview"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"论文", "文献", "arxiv", "preprint", "citation", "被引", "引用数", "impact factor",
			"survey paper", "state of the art", "benchmark 论文", "ablation", "模型架构论文",
			" paper",
		},
	},
	"ai-models": {
		apiProviders: []string{"huggingface"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"huggingface", "开源模型", "模型权重", "预训练模型", "开源 llm", "开源大模型",
			"模型下载", "download model", "model weights", "open weights", "base model",
		},
	},
	"entities": {
		apiProviders: []string{"wikidata"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"who is", "是谁", "什么人", "创始人", "founder of", "ceo of", "cto of",
			"人口", "population of", "capital of", "首都", "wikidata",
		},
	},
	"geo": {
		apiProviders: []string{"nominatim", "wikidata"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"在哪", "位置", "坐标", "地址", "地标", "地图", "经纬度",
			"where is", "location of", "coordinates", "address of", "landmark", "geocode",
		},
	},
	// 探针第 11 批新增窄意图域: 地震(usgsquakes 独占; 不并 geo 防泛地理查询烧腿/
	// 地震题被 nominatim 地理编码污染——实弹"最近地震"nominatim 把查询当地点名返回街道)
	"quakes": {
		apiProviders: []string{"usgsquakes"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"最近地震", "最新地震", "今天地震", "最新震情", "近期地震",
			"recent earthquake", "latest earthquake", "earthquake today",
		},
	},
	"images": {
		apiProviders: []string{"openverse", "commonswiki", "nasaimages"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords:     []string{"图片", "照片", "配图", "图搜", "cc 图片", "可商用图片", "stock photo", "image of", "壁纸", "wallpaper", "nasa 图", "nasa", "太空照片", "space photo", "星系照片"},
	},
	"security": {
		apiProviders: []string{"nvd", "osv", "ghsa"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"cve-", "cve ", "漏洞", "exploit", " rce ", "0-day", "0day", "vulnerability", // "rce" 裸子串误伤 woocommerce/force/source(批 10 实弹抓获), 空格锚定
			"安全公告", "security advisory", "ransomware", "勒索", "攻击样本",
		},
	},
	"news": {
		apiProviders: []string{"googlenews", "bingnews"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			" news ", "latest news", "breaking news", "news today", "top news", "world news",
			"快讯", "最新消息", "新闻",
		},
	},
	// 探针第 11 批新增域: 歌词(lrclib; 接管 music 域的 歌词/lyrics 词面, 专源优于录音库)
	"lyrics": {
		apiProviders: []string{"lrclib"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"歌词", "歌詞", "lyrics", "歌词是什么", "歌词查询",
		},
	},
	"dictionary": {
		apiProviders: []string{"wiktionary"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"什么意思", "是什么意思", "意思是", "释义", "词源", "词典", "词条",
			"meaning of", "definition of", "etymology", "word origin", "dictionary",
		},
	},
	// 探针第 11 批新增域: 化学(pubchem; 只收属性词面, 泛词"化学"不收防课程/作业类误引)
	"chemistry": {
		apiProviders: []string{"pubchem"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"分子式", "化学式", "分子量", "摩尔质量", "分子结构", "化合物",
			"molecular formula", "molar mass", "chemical compound",
		},
	},
	"medical": {
		apiProviders: []string{"europepmc", "clinicaltrials"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"clinical trial", "clinical study", "randomized", "meta-analysis", "systematic review",
			"cohort study", "pubmed", "europe pmc",
			"临床试验", "随机对照", "荟萃分析", "系统综述", "循证",
		},
	},
	"data": {
		apiProviders: []string{"worldbank"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"world bank", "worldbank", "开放数据", "open data", "宏观数据",
			"统计数据", "statistics data", "统计年鉴", "世界银行",
		},
	},
	// 探针第 6 批新增域: 天气(open-meteo 双腿车道)
	"weather": {
		apiProviders: []string{"openmeteo"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"天气", "weather", "气温", "temperature", "预报", "forecast",
			"降水", "降雨", "下雨", "下雪", "湿度", "humidity",
		},
	},
	// 探针第 7 批新增域: 音乐(录音库 1req/s 腿内单请求天然合规)
	"music": {
		apiProviders: []string{"musicbrainz"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"歌曲", "音乐", "专辑", "单曲", "录音室版本", "谁唱的", "翻唱",
			"这首歌", "什么歌", "哪首歌",
			"song", "music", "album", "recording of",
		},
	},
	// 探针第 7 批新增域: 航天发射(thespacedevs 匿名限流 15 req/h, 域窄词面即守卫防烧配额)
	"space": {
		apiProviders: []string{"thespacedevs"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"火箭", "发射窗口", "发射任务", "发射计划", "火箭发射", "航天发射",
			"rocket launch", "launch window", "launch schedule", "spacex", "falcon 9", "starship", "ariane", "sls",
		},
	},
	// 探针第 7 批新增域: 浏览器扩展(AMO 只收 firefox 词面, 泛词会错引 chrome 需求)
	"browser-ext": {
		apiProviders: []string{"mozaddons"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"firefox 扩展", "firefox 插件", "firefox addon", "firefox 附加组件", "amo",
			"firefox extension", "addons.mozilla",
		},
	},
	// 探针第 8 批新增域: 剧集(tvmaze, 官方无限流; 泛词"电影"不引 — 非剧集语义)
	"tv": {
		apiProviders: []string{"tvmaze"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"电视剧", "美剧", "英剧", "日剧", "剧集", "第几季", "哪部剧", "剧推荐", "追剧",
			"tv show", "tv series", "sitcom",
		},
	},
	// 探针第 8 批新增域: 播客(itunes Apple 官方, ~20 req/min 腿内单请求合规)
	"podcast": {
		apiProviders: []string{"itunes"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"播客", "播客推荐", "播客节目", "podcast", "podcasts",
		},
	},
	// 探针第 8 批新增域: 游戏(steam storesearch; 实弹确认仅英文词面, 中文词 0 结果正常降级)
	"games": {
		apiProviders: []string{"steam"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"游戏推荐", "好玩的游戏", "买游戏", "pc 游戏", "steam 游戏", "游戏打折",
			"steam game", "pc game", "buy game", "game deal", "game on steam",
		},
	},
	// 探针第 8 批新增域: 物种(gbif 生物多样性 backbone + uniprot 蛋白库[批 10]; 拉丁名/俗名/蛋白词面)
	"species": {
		// 探针第 12 批域加强: inaturalist(俗名/观察数/灭绝标记, 中英词面双通)
		apiProviders: []string{"gbif", "uniprot", "inaturalist"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"物种", "学名", "拉丁名", "分类学", "生物分类", "动植物分类",
			"species", "taxonomy", "scientific name",
			// 探针第 10 批域加强: uniprot(蛋白质/酶词面; "蛋白"裸词不收—蛋白粉/烹饪误引)
			"蛋白质", "protein", "酶", "enzyme", "氨基酸序列",
		},
	},
	// 探针第 8 批新增域: 法律(federalregister 法规 + courtlistener 判例双腿)
	"legal": {
		apiProviders: []string{"federalregister", "courtlistener"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"联邦法规", "美国法规", "法规查询", "联邦公报", "判例", "判例法", "案例法",
			"federal register", "court case", "case law", "legal ruling", "federal regulation",
		},
	},
	// 探针第 8 批新增域: 药物(openfda 药品标签; 与 medical 域(临床/文献)意图分层)
	"drug": {
		apiProviders: []string{"openfda"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"药品说明书", "药物", "用药", "适应症", "剂量", "药品查询",
			"drug label", "medication", "prescription drug", "dosage",
		},
	},
	// 探针第 9 批新增域: 加密货币/金融(coingecko; 免费档限频极严 5 连打即 429,
	// 依赖 crypto 窄词面守卫天然限流; 三字母 btc/eth 会误伤 method/其他词不收)
	"finance": {
		apiProviders: []string{"coingecko", "frankfurter"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"加密货币", "数字货币", "虚拟货币", "比特币", "以太坊", "区块链", "币价",
			"代币价格", "山寨币", "狗狗币", "稳定币", "交易所排名",
			"crypto", "bitcoin", "ethereum", "blockchain", "web3", "nft", "defi",
			"altcoin", "dogecoin", "solana", "coin price", "coinmarket",
			// 探针第 11 批域加强: frankfurter(法币汇率; "汇率/兑换" 词面意图唯一无歧义)
			"汇率", "兑换", "汇率换算", "exchange rate", "currency",
		},
	},
	// 探针第 9 批新增域: 食谱(themealdb; 实弹确认仅英文词面, asciiFace 降级; "做法"太泛不收)
	// 探针第 12 批域加强: openfoodfacts(加工食品营养, 与 themealdb 纯食谱互补; 只收成分/配料词面)
	"food": {
		apiProviders: []string{"themealdb", "openfoodfacts"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"食谱", "菜谱", "怎么做", "美食", "食材", "晚餐做什么", "菜推荐",
			"recipe", "cooking", "ingredients",
			"营养成分", "配料表",
		},
	},
	// 探针第 9 批新增域: 动漫(kitsu, Jikan/MAL 关账替代; "动画"会误伤 css 动画,
	// 但表序 programming 在前截胡, 风险可控)
	// 探针第 11 批新增域: 漫画(mangadex; title 匹配含各语 altTitles, 实弹中文直中)
	"manga": {
		apiProviders: []string{"mangadex"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"漫画", "漫画推荐", "韩漫", "连载", "下一话", "番外",
			"manga", "manhwa", "manhua",
		},
	},
	"anime": {
		apiProviders: []string{"kitsu"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"动漫", "番剧", "新番", "追番", "动画推荐", "哪部动漫", "动漫推荐",
			"anime", "manga", "日本动画",
		},
	},
	// 探针第 9 批新增域: 体育(thesportsdb 球队库; 免费档 30 req/min, sport 窄词面守卫)
	"sport": {
		apiProviders: []string{"thesportsdb"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"球队", "篮球队", "足球队", "橄榄球队", "球队资料", "球队介绍", "队伍",
			"sports team", "nba team", "football club", "英超球队", "西甲球队",
		},
	},
	// 探针第 9 批新增域: 书籍(standardebooks 公版书; gbooks/openlibrary/gutendex 全关账后 books 词面重启)
	"books": {
		apiProviders: []string{"standardebooks"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"公版书", "经典文学", "名著", "古典小说", "小说推荐", "电子书",
			"ebook", "e-book", "public domain book", "standard ebooks", "古腾堡",
		},
	},
	// 探针第 10 批新增域: 鸡尾酒(thecocktaildb, themealdb 姊妹站 test key "1"; 实弹仅英文词面 asciiFace 降级)
	"drinks": {
		apiProviders: []string{"thecocktaildb"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"鸡尾酒", "调酒", "调酒配方", "酒谱", "基酒", "莫吉托", "玛格丽特", "马天尼",
			"cocktail", "cocktail recipe", "drink recipe", "mixology", "margarita", "mojito",
		},
	},
	// 探针第 10 批新增域: 旅行指南(wikivoyage, MediaWiki action API; 实弹中文词面可用)
	"travel": {
		apiProviders: []string{"wikivoyage"},
		siteTargets:  []string{"wikivoyage.org"}, // 实弹: 简体中文 wikivoyage API 0 命中, site: 腿由通用引擎承接 zh 查询
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"旅行攻略", "旅游攻略", "旅行指南", "自由行", "背包客", "穷游", "城市指南",
			"旅行路线", "景点推荐", "必去景点",
			"travel guide", "travel itinerary", "things to do in", "backpacker",
		},
	},
	// 探针第 10 批新增域: IDE 扩展(openvsx VS Code 生态 + jetbrains 双源; 与 browser-ext(firefox 专属)意图分层)
	"ide-ext": {
		apiProviders: []string{"openvsx", "jetbrains"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"vscode 扩展", "vscode 插件", "vs code 插件", "vscode extension", "编辑器插件",
			"jetbrains 插件", "intellij 插件", "idea 插件", "pycharm 插件", "goland 插件",
			"ide 插件", "ide extension",
		},
	},
	// 探针第 10 批新增域: WordPress 插件(wpplugins, 官方目录 API)
	"wordpress": {
		apiProviders: []string{"wpplugins"},
		siteTargets:  []string{},
		siteEngines:  []string{"duckduckgo"},
		keywords: []string{
			"wordpress 插件", "wp 插件", "wordpress plugin", "wp plugin", "woocommerce",
			"wordpress 建站", "wordpress seo",
		},
	},
}

// 表序即优先级(map 迭代无序, 显式列序)
var domainTableOrder = []string{
	"packages", "devops", "programming", "academic", "ai-models", "entities",
	"quakes", "geo", "images", "security", "news", "dictionary", "chemistry", "medical", "data", "weather",
	"lyrics", "music", "space", "browser-ext", "ide-ext", "wordpress", "tv", "podcast", "games",
	"species", "legal", "drug", "finance", "drinks", "food", "manga", "anime", "sport", "books", "travel",
}

// packages 主题按语言信号裁剪腿(质量评测 case-4: rust 题不空跑 npm 腿)
// b15 质量抽检补 python→pypi: "python 包 推荐 http 客户端"无信号命中→全源空跑,
// rubygems 对中文空查返回随机新包霸榜(xhttp@0.1.0), pypi 真结果被挤掉
var packageLangSignals = []struct {
	signals  []string
	provider string
}{
	{[]string{"python", "pip", "pypi", "python包"}, "pypi"},
	{[]string{"rust", "cargo", "crate"}, "crates"},
	{[]string{"npm", "node", "nodejs", "node.js", "javascript", "typescript"}, "npm"},
	{[]string{"php", "composer", "packagist"}, "packagist"},
	{[]string{"ruby", "rubygems", "gemfile"}, "rubygems"},
	{[]string{"perl", "cpan"}, "metacpan"},
	{[]string{"dotnet", ".net", "c#", "csharp", "nuget"}, "nuget"},
	{[]string{"elixir", "mix.exs", "hex.pm"}, "hex"},
	// 探针第 12 批: pubdev(dart/flutter 语言空白)
	{[]string{"dart", "flutter", "pubspec", "pub.dev"}, "pubdev"},
}

func condensePackagesLeg(query string, apiProviders []string) []string {
	low := strings.ToLower(query)
	for _, ps := range packageLangSignals {
		for _, s := range ps.signals {
			if strings.Contains(low, s) {
				var pick []string
				for _, p := range apiProviders {
					if p == ps.provider {
						pick = append(pick, p)
					}
				}
				if len(pick) > 0 {
					return pick
				}
			}
		}
	}
	return apiProviders
}

// 中文题强化腿(纯英文题打它们是噪音): sov2ex
var cjkRe = regexp.MustCompile(`[\x{4e00}-\x{9fff}]`)

func zhBoostProviders(query string) []string {
	if cjkRe.MatchString(query) {
		return []string{"sov2ex"}
	}
	return []string{}
}

type domainRoute struct {
	topic        string
	apiProviders []string
	siteQueries  []string
	siteEngines  []string
}

// lookupDomains: 小写子串匹配 keywords; 命中多个取表序第一个; 未命中 nil
func lookupDomains(query string) *domainRoute {
	low := " " + strings.ToLower(strings.TrimSpace(query)) + " "
	for _, topic := range domainTableOrder {
		def := domainTable[topic]
		hit := false
		for _, k := range def.keywords {
			if strings.Contains(low, strings.ToLower(k)) {
				hit = true
				break
			}
		}
		if !hit {
			continue
		}
		providers := append([]string{}, def.apiProviders...)
		if topic == "programming" {
			providers = append(providers, zhBoostProviders(query)...)
		}
		if topic == "packages" {
			providers = condensePackagesLeg(strings.TrimSpace(query), providers)
		}
		siteQueries := make([]string, 0, len(def.siteTargets))
		for _, d := range def.siteTargets {
			siteQueries = append(siteQueries, fmt.Sprintf("%s site:%s", strings.TrimSpace(query), d))
		}
		return &domainRoute{
			topic: topic, apiProviders: providers,
			siteQueries: siteQueries, siteEngines: append([]string{}, def.siteEngines...),
		}
	}
	return nil
}

// laneLegProviders (phase AE): 混源主题 leg-0 补聚合兜底腿防窄腿塌方; registry 专线保纯度
// b14 扩员(评测 19 miss 逐题归因裁决): 白名单制→排除清单制, domain-route 全域默认接
// 兜底 — 批 7-12 窄域(chemistry/food/drinks/books/anime/legal/drug/tv/travel...)
// API 腿对中文词面/专源语料天花板空手而归时无通用引擎救, 用户可见 0 refs;
// fusion authority v3 排序兜质量(wikidata/USGS 等权威腿仍居前)。
// b14 兜底源替换: searxng→keenable — 两个公共 searxng 实例 SEO 污染实锤(返赌博站/
// windows help 垃圾页, python 直探实锤), keenable 同 query 直测返回维基百科级质量,
// 且 POST JSON 公共路稳定(1000/h per IP); searxng 保留在 web 全池路由(wait 自愈)。
var legFallbackExclude = map[string]bool{
	// entities: wikidata claims 直答语义, 通用引擎新闻页混入稀释 top-1 直答 (保守排除)
	// b17 外部基准(NQ-open)改为意图条件化 — 见 legFallbackAllowed
	"entities": true,
}

// legFallbackAllowed (b17): entities 的兜底排除意图条件化。
// 外部基准实锤: "who is the coach/secretary of state/host/actor..." 这类非实体属性
// 意图查询被 "who is" 词面截胡进 entities 车道, 而 coach/部长/演员/主持不在
// b13AnswerProps(claims 答不了), 纯路=静默零输出(NQ-open 200 题 8 例, 占 miss 17%)。
// 规则: 查询携带答案属性意图词(创始人/首都/人口/总部/成立/发布/出生/国家, claims 可
// 直答) → 维持 b14 纯路防稀释; 其余 → 放开通用兜底腿, 零输出优于不救。
func legFallbackAllowed(topic, query string) bool {
	if !legFallbackExclude[topic] {
		return true
	}
	return b13QueryIntentPID(query) == ""
}

func laneLegProviders(topic, query string, apiProviders []string) []string {
	// tavily 幽灵腿顺手清账: registry 从未注册 tavily lane, 恒 failed 只污染 journal
	// (images 的 keenable 特判同步删除: fallback 本身已含 keenable, 保留会双跑同腿)
	fallback := []string{"keenable"}
	if !legFallbackAllowed(topic, query) {
		return append([]string{}, apiProviders...)
	}
	return append(append([]string{}, apiProviders...), fallback...)
}

// ---------- Planner (对齐 TS planner.ts) ----------
var researchHints = []string{
	"深度研究", "研究一下", "调研", "全面分析", "综述", "深度分析", "系统分析",
	"deep research", "in-depth", "state of the art", "survey", "landscape",
	"来龙去脉", "发展历程", "优缺点对比", "可行性",
}
var multiHints = []string{" 对比 ", " 比较 ", " vs ", " versus ", " 哪个", " 差异", " 区别", " 不同点"}
var xHints = []string{"site:x.com", "site:twitter.com", "推特", "推文", "twitter 上", "x 上", "x.com"}
var ghHints = []string{"github", "开源仓库", "开源实现", "repo:", "源码仓库"}

type plannerDecision struct {
	complexity string // simple | multi | research
	queries    []string
	route      string // web | domain | github | x
	reasons    []string
	lang       string // phase AA: CJK>=2 → zh
	domainPlan *domainRoute
}

// plan: 查询语言自动检测(CJK≥2→zh) + planBase
func plan(query string) plannerDecision {
	d := planBase(query)
	cjkCount := len(cjkRe.FindAllString(query, -1))
	if cjkCount >= 2 {
		d.lang = "zh"
	}
	return d
}

func planBase(query string) plannerDecision {
	q := strings.TrimSpace(query)
	low := strings.ToLower(q)
	reasons := []string{}

	// 路由判断(优先级: x > github > web)
	for _, h := range xHints {
		if strings.Contains(low, h) {
			return plannerDecision{complexity: "simple", queries: []string{q}, route: "x", reasons: append(reasons, "x-related keywords")}
		}
	}
	for _, h := range ghHints {
		if strings.Contains(low, h) {
			return plannerDecision{complexity: "simple", queries: []string{q}, route: "github", reasons: append(reasons, "github-related keywords")}
		}
	}

	// research 判断(P5 移植 research loop; 现退化为单轮并行语义)
	for _, h := range researchHints {
		if strings.Contains(low, h) {
			return plannerDecision{complexity: "research", queries: []string{q}, route: "web", reasons: append(reasons, "research keywords/length")}
		}
	}
	if len(q) > 120 {
		return plannerDecision{complexity: "research", queries: []string{q}, route: "web", reasons: append(reasons, "research keywords/length")}
	}

	// multi 判断: 对比句式拆分
	for _, h := range multiHints {
		idx := strings.Index(low, strings.TrimSpace(h))
		if idx != -1 {
			parts := splitComparison(q)
			if len(parts) >= 2 {
				return plannerDecision{
					complexity: "multi", queries: parts, route: "web",
					reasons: append(reasons, fmt.Sprintf("multi-comparison pattern %q", strings.TrimSpace(h))),
				}
			}
		}
	}

	// 多问句拆分
	var questions []string
	for _, s := range regexpQuestionSplit.Split(q, -1) {
		if s = strings.TrimSpace(s); len(s) > 4 {
			questions = append(questions, s)
		}
	}
	if len(questions) >= 2 {
		return plannerDecision{
			complexity: "multi", queries: questions, route: "web",
			reasons: append(reasons, fmt.Sprintf("%d question sentences", len(questions))),
		}
	}

	// v0.6 域名路由(放在 x/github/research/multi 之后)
	if dr := lookupDomains(q); dr != nil {
		return plannerDecision{
			complexity: "simple",
			queries:    append([]string{q}, dr.siteQueries...),
			route:      "domain",
			reasons:    append(reasons, fmt.Sprintf("domain-route: %s (tier1: %s)", dr.topic, strings.Join(dr.apiProviders, "/"))),
			domainPlan: dr,
		}
	}

	return plannerDecision{complexity: "simple", queries: []string{q}, route: "web", reasons: reasons}
}

var regexpQuestionSplit = regexp.MustCompile(`[?？]`)

// splitComparison: "比较 A 和 B" → ["A", "B", 原 query]
var compareRe = regexp.MustCompile(`(?:比较|对比|区别|差异)[:：]?\s*(.+?)(?:\s*(?:和|与|跟|vs|及)\s*(.+?))?(?:的)?(?:差异|区别|优缺点|哪个好)?[?？。!！]?$`)
var vsSplitRe = regexp.MustCompile(`(?i)\s+vs\.?\s+|\s+versus\s+`)

func splitComparison(q string) []string {
	if m := compareRe.FindStringSubmatch(q); m != nil {
		a, b := strings.TrimSpace(m[1]), strings.TrimSpace(m[2])
		if a != "" && b != "" {
			return []string{a, b, q}
		}
	}
	vs := vsSplitRe.Split(q, -1)
	var cleaned []string
	for _, s := range vs {
		if s = strings.TrimSpace(s); s != "" {
			cleaned = append(cleaned, s)
		}
	}
	if len(cleaned) >= 2 && len(cleaned) <= 4 {
		return append(cleaned, q)
	}
	return nil
}
