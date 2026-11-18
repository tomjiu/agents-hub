# zai-bridge —— 多阶段构建
# 目标：镜像尽量小、常驻内存低

# ---------- 阶段 1：构建 Go 二进制 ----------
FROM golang:1.24-alpine AS gobuild
WORKDIR /src

# 先只拷依赖清单，利用层缓存
COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 GOOS=linux go build \
      -trimpath -ldflags="-s -w" \
      -o /out/zai-bridge ./cmd/zai-bridge

# ---------- 阶段 2：构建验证码求解器 ----------
FROM node:24-alpine AS nodesolver
WORKDIR /captcha
COPY captcha/package.json captcha/package-lock.json* ./
# 需要 esbuild 转译 TypeScript，所以这里装全量依赖
RUN npm ci --no-audit --no-fund
COPY captcha/captcha-happy.ts captcha/solver.mjs ./
# 把 .ts 转成纯 .mjs：运行期不再依赖 Node 的类型剥离实验特性
RUN npm run build && npm prune --omit=dev

# ---------- 阶段 3：运行时 ----------
FROM node:24-alpine

# 只需要 node（验证码求解器）和 Go 二进制，不需要 Alpine 的额外包
RUN adduser -D -h /home/bridge bridge

WORKDIR /app
COPY --from=gobuild /out/zai-bridge /app/zai-bridge
COPY --from=nodesolver /captcha /app/captcha

# 验证码 CDN 缓存放在这里，挂 volume 可复用（省掉每次冷启动的下载）
ENV HOME=/home/bridge
RUN mkdir -p /home/bridge/.zcode-captcha-cdn-cache && \
    chown -R bridge:bridge /home/bridge /app

USER bridge

# 验证码调参（详见 internal/zai/captcha_pool.go 注释）：
#   STALL=10s  —— 成功的求解一定在 6s 内完成，失败的永远卡死，短阈值能快速失败重试
#   WORKERS=2  —— 并行 2 个求解进程，把约 50% 的单次成功率抬到 ~84%
#   ROUNDS=3   —— 外层再重试 3 轮，兜住「同时抽到坏版本」的 ~16%
ENV CAPTCHA_STALL_MS=10000 \
    ZAI_CAPTCHA_WORKERS=2 \
    ZAI_CAPTCHA_ROUNDS=3 \
    NODE_OPTIONS="--max-old-space-size=256"

ENTRYPOINT ["/app/zai-bridge"]
