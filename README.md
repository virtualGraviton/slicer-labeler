# slicer-labeler

音频切分标注平台：上传/导入音频数据集 → AI 语音识别 + 自动切分 → 人工逐条标注/校对（可连播、标记、合并、切分、删除）→ 导出归档。

## 技术栈

| 端 | 技术 |
|---|---|
| 后端 | Go 1.25 · Echo v4 · GORM · PostgreSQL · MinIO(S3) · DeepSeek API |
| 前端 | React 18 · Vite 5 · Tailwind CSS · framer-motion · react-router |
| 部署 | 后端：GitHub Actions 构建镜像 → GHCR → Sealos（App Launchpad）自动部署；前端：Cloudflare Pages 自动集成 |

## 目录结构

```
.
├── main.go                     # 服务入口：配置、DB、中间件、路由注册、优雅退出
├── Dockerfile                  # 后端镜像（linux/amd64）
├── Makefile                    # build / run / dev(air) / docker-build / test
├── .env.example                # 环境变量模板
├── internal/
│   ├── config/                 # 环境变量加载与校验
│   ├── db/                     # GORM 连接、AutoMigrate、Seed、各实体数据访问
│   ├── handler/                # HTTP handler：路由注册 + 请求编排
│   ├── middleware/             # 鉴权等中间件
│   ├── model/                  # 数据模型与任务定义
│   └── service/                # 业务逻辑：认证、存储(S3)、音频、DeepSeek、文件名
├── frontend/
│   ├── src/
│   │   ├── pages/              # 页面：标注页、数据集列表、模型、管理、登录
│   │   ├── components/         # 组件：标注行、波形播放器、切分/合并/导入弹窗等
│   │   ├── context/            # 全局状态：Auth、Task(SSE)
│   │   └── utils/api.js        # 统一请求封装（token / 401 / SSE / 分片上传）
│   └── functions/api/          # Cloudflare Pages Functions（反代后端）
└── docs/                       # 开发规范
```

## 快速开始

### 后端

```bash
# 1. 配置环境变量（devbox 已准备测试数据库，复制模板并核对 DATABASE_URL 即可）
cp .env.example .env

# 2. 依赖与启动
make deps        # 或 go mod tidy
make dev         # air 热重载（需先 go install github.com/air-verse/air@latest）
# 或
make run         # 编译 + 运行
```

- 默认监听 `:8080`，健康检查 `GET /api/health`。
- 启动时自动执行 `AutoMigrate` 与角色种子数据。
- 本地开发 `DEV_MODE=1` 可免 GitHub OAuth；生产必须配置 GitHub 三参数。
- 测试：`make test`（`go test ./...`）。

### 前端

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173，/api 自动代理到 http://localhost:8080
```

构建：`npm run build`（产物 `dist/`，由 Cloudflare Pages 自动发布）。

## 部署

- **后端**：推送到 `main`（仅后端路径，见 [publish-ghcr.yml](.github/workflows/publish-ghcr.yml) 的 `paths`）→ 自动构建镜像（`ghcr.io/…/slicer-labeler:sha-<完整commit>`）→ 通过 Sealos App Launchpad v2alpha API 更新应用并等待就绪。回滚：Actions 手动触发填旧 tag。
- **前端**：`frontend/**` 改动走 Cloudflare Pages 自动集成，不触发后端构建。
- 详见 [docs/deploy-sealos.md](docs/deploy-sealos.md)（Sealos 运维与踩坑记录）。

## 开发规范

- 后端：[docs/backend-guide.md](docs/backend-guide.md)
- 前端（含**并发竞态与异步状态管理**专章）：[docs/frontend-guide.md](docs/frontend-guide.md)
