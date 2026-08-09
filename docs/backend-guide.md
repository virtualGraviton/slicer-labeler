# 后端开发规范（Go / Echo / GORM）

> 适用于 `slicer-labeler` 后端。原则：**分层清晰、权限先行、并发写有保护、响应格式统一**。
> 新增功能前先读一遍本文，尤其是「handler 层」「并发与任务」两节。

## 1. 技术栈与分层

```
HTTP 请求
  → internal/handler    HTTP 编排：绑定参数、鉴权/权限、调用 store/service、拼响应
  → internal/service    业务逻辑：认证、S3 存储、音频处理、DeepSeek、文件名
  → internal/db         GORM 数据访问（Store 模式）
  → internal/model       数据模型 / 请求响应结构
  → PostgreSQL
```

- 依赖：Go 1.25 · Echo v4 · GORM + PostgreSQL · MinIO (S3) · DeepSeek API
- 入口 `main.go`：加载配置 → 连库 → AutoMigrate + Seed → 中间件 → `handler.RegisterRoutes` → 优雅退出。

## 2. handler 层

### 2.1 结构约定

每个 handler 是一个 struct + 构造器 + 方法，与 `route.go` 一一对应：

```go
type EntryHandler struct {
	store        *db.EntryStore
	datasetStore *db.DatasetStore
	tm           *TaskManager
	auth         *service.AuthService
}

func NewEntryHandler(store *db.EntryStore, datasetStore *db.DatasetStore, tm *TaskManager, auth *service.AuthService) *EntryHandler {
	return &EntryHandler{store: store, datasetStore: datasetStore, tm: tm, auth: auth}
}
```

### 2.2 每个 handler 方法的固定顺序（参考 `entry.go` List / BatchUpsert）

1. `ctx := c.Request().Context()`，`user, _ := c.Get("user").(*db.User)`
2. 解析路径参数（`c.Param`，无效返回 400）
3. **权限校验先行**：
   - 读：`h.auth.CanReadDataset(ctx, user, datasetID)`，失败返回 **404**（不泄露存在性）
   - 写：`h.auth.CanWriteDataset(...)`，失败返回 **403** `{"error":"无权限"}`
4. **写操作必须先查任务锁**：`if err := datasetBusy(h.tm, datasetID); err != nil { return err }`（见 §6）
5. 绑定请求体：`c.Bind(&req)`，失败 400
6. 调 store/service，失败 500 并返回 `{"error": err.Error()}`
7. 成功返回统一结构（分页用 `model.PaginatedResponse`）

### 2.3 响应格式

- JSON 一律 `c.JSON(...)`，错误统一 `map[string]string{"error": "..."}`（**给前端可读的 message**）。
- 分页结构：`model.PaginatedResponse{Data, Total, Page, PageSize}`，字段 camelCase。
- 状态码语义：400 参数错 / 401 未认证（全局处理） / 403 无权限 / 404 不存在 / 500 服务端错。

## 3. db 层（Store 模式）

- 一个实体一个 Store：`db.NewXxxStore(gormDB)`，方法签名带 `ctx`（如 `Get(ctx, id)`、`ListByDataset(ctx, datasetID, page, pageSize)`）。
- 方法返回 `(实体, 总数, error)` 模式，分页逻辑收在 Store 内，handler 不写 SQL。
- 查询用 GORM 链式 API；涉及多步写注意事务（`gormDB.Transaction`）。

## 4. service 层

- 存放**跨 store / 外部依赖**的逻辑：S3 上传下载、音频切分、DeepSeek 调用、OAuth、文件名规则。
- 构造器显式接收依赖（`service.NewXxxService(...)`），不依赖全局单例。
- 外部 API（DeepSeek）调用失败要向上返回可诊断的错误，由 handler 转 500。

## 5. model 层

- `internal/model/types.go`：DB 模型（GORM tag）。
- 请求/响应结构体定义在 handler 用到时放 model 包，便于前端对照。
- JSON tag 统一 camelCase（如 `wavPath`、`pageSize`）。

## 6. 并发与任务（重点）

- 数据集在跑任务（导入/切分/归档）期间，**该数据集所有写操作必须被锁**：
  handler 写操作先 `datasetBusy(h.tm, datasetID)` 拦截，返回 409。
- `TaskManager` 管理任务状态与 SSE 事件（`internal/handler/task.go`）。新增异步任务时：
  - 启动任务前检查 `datasetBusy`
  - 任务结束正确置空闲并广播事件
  - 不要在 handler 里直接 go routine 裸跑，走 TaskManager 统一管理生命周期

## 7. 路由注册

全部在 `internal/handler/route.go` 的 `RegisterRoutes`：
- 公开端点（`/api/health`、`/api/auth/*`）放在 `sec` group 外；
- 其余一律挂 `sec := api.Group("", appmw.RequireAuth(authSvc))`；
- 权限在 handler 内用 `authSvc` 细粒度校验（CanRead/CanWrite）。

## 8. 配置（环境变量）

- 全部由 `internal/config/config.go` 加载校验；`main.go` 只消费 `cfg`，不直接读 os.Getenv。
- 模板见 `.env.example`，新增配置必须同步更新模板与 `config.Load` 校验。
- 安全：`DEV_MODE=1` 免 GitHub OAuth（本地）；生产必须配 JWT_SECRET + GitHub 三参数。

## 9. 数据库

- 迁移：启动时 `db.AutoMigrate`（单副本场景安全）。**约定：不要同时跑两个版本的迁移**。
- 种子：`db.SeedRoles` 初始化角色。
- 改表结构：优先加字段/新表（AutoMigrate 幂等），避免破坏性 DDL。

## 10. 本地验证（devbox）

- 测试数据库：devbox 已准备，`cp .env.example .env` 核对 `DATABASE_URL` 后可直接 `make dev`。
- 单元测试：`make test`（`go test ./...`）；新增逻辑尽量补测试。
- 改动后端后用 curl 验证关键接口（如 `GET /api/health`、目标接口），再走 CI 部署。

## 11. 代码风格

- Go 标准命名（导出大写、缩写不大写如 `db`、`ID` 而非 `Id`）。
- 错误必须被处理：要么返回，要么 `log`；不吞错。
- handler 保持薄：复杂逻辑下沉 service/store。
- 中文注释只用于说明业务意图，代码本身遵循 Go 习惯（英文标识符）。
