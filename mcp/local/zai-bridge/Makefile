# zai-bridge 构建入口
#
# 关于杀软误报：Go 静态编译的单文件 exe 没有数字签名、没有版本资源，
# 再叠加「内存里模拟浏览器 DOM」的行为，很容易被启发式引擎标记。
# 实测加上 -s -w 削减符号表/调试信息后，卡巴斯基不再拦截产物。
# 如果仍被拦，请把产物目录加入杀软排除列表，或改用 Docker 部署。

BIN     := zai-bridge.exe
BUILD   := go build
LDFLAGS := -s -w -X main.version=0.3.1

.PHONY: all build vet test check smoke ci clean docker docker-build captcha-build

all: build

# 默认构建：削减符号，产物更小也更容易过扫描
build:
	$(BUILD) -trimpath -ldflags "$(LDFLAGS)" -o $(BIN) ./cmd/zai-bridge

vet:
	go vet ./...

# 单元测试（纯函数，不联网）
test:
	go test ./internal/...

# 一键本地 CI：静态检查 + 单测 + 构建，不需要 token、不联网
ci: vet test
	$(BUILD) -trimpath -ldflags "$(LDFLAGS)" -o $(BIN) ./cmd/zai-bridge
	@echo "CI 通过"

# 自检：验证 token + 验证码链路
check: build
	./$(BIN) check

# 端到端冒烟：跑一遍所有 MCP 工具（只读）
# 加 --write 会真的建会话发消息，消耗一次 Agent Mode 额度：
#   node scripts/smoke.mjs --write
smoke:
	node scripts/smoke.mjs

# 验证码求解器：把 .ts 转成纯 .mjs，避免依赖 Node 的类型剥离实验特性
captcha-build:
	cd captcha && npm run build

# Docker（需要 Docker Desktop / 引擎已启动）
docker-build:
	docker build -t zai-bridge:latest .

docker:
	docker compose up -d --build

clean:
	rm -f $(BIN)
	rm -rf .tmp
