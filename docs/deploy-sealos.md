# 部署与 Sealos 运维记录（精简版）

> 完整踩坑细节与历史见工作区文档 `/.trae/documents/slicer-labeler-auto-deploy-sealos.md`。
> 本文是仓库内可直接查阅的核心结论。

## 架构

- **后端**：Go 服务托管在 Sealos 云（namespace `ns-kfay6i93`，应用 `slicer-labeler-backend`），镜像在 GHCR（私有）。
- **前端**：`frontend/` 静态产物 + Pages Functions，走 Cloudflare Pages 自动集成（CF 检测 main 分支提交自行构建）。
- **自动发布**：`main` 推送后端路径 → [publish-ghcr.yml](../.github/workflows/publish-ghcr.yml) 构建镜像（`sha-<完整commit>` + `latest`）→ GHCR → **Sealos App Launchpad v2alpha API** 更新应用镜像 → 轮询 `status=running` 就绪。

## 关键机制（维护时注意）

- Sealos 平台托管 StatefulSet / Service / Ingress / PVC；**平台字段（env/端口/存储/域名）一律在 UI 改**，CI 只动镜像。
- 更新镜像走 v2alpha API：`PATCH /api/v2alpha/apps/<app>`，body 只传 `{"image":{"imageName":"<full>"}}`（部分更新，其余字段保留）。鉴权：kubeconfig base64 → URL-encode → `Authorization` 头。
- **v2alpha 状态枚举没有 `ready`**，就绪态是 `running`；`error`/`pause` 视为失败。
- 健康探针：`GET /api/health`（readiness 5s/10s/3 次，liveness 20s/20s/3 次），滚动发布质量的前提。
- 回滚：Actions 手动触发 `workflow_dispatch` 填 `image_tag`（跳过构建直接部署旧 tag）。

## 踩坑记录（重要）

1. **metadata-action 短哈希坑**：`docker/metadata-action` 的 `type=sha` 默认生成 7 位短哈希，与部署引用的完整 `${{ github.sha }}` 不一致 → Sealos 拉镜像 NotFound。**必须 `type=sha,prefix=sha-,format=long`**。
2. **merge-patch 数组整体替换**：用 curl `application/merge-patch+json` patch 数组字段（containers/env 等）会整体清空。改 StatefulSet 数组字段必须带全量或用 kubectl（strategic merge）。生产操作优先 kubectl。
3. **不要绕过平台改 Ingress**：Ingress 由 Sealos 托管，绕过平台修改会被 reconcile 回退（历史上另一个应用域名掉线与此相关）。

## 环境变量 / Secrets

- Secret `KUBECONFIG_B64`：Sealos kubeconfig 的 base64（`base64 -w0 kubeconfig`），生产仓库必须配置。
- Variable `SEALOS_API_URL`（可选覆盖默认 `https://applaunchpad.bja.sealos.run/api/v2alpha/apps`）、`APP_NAME`（默认 `slicer-labeler-backend`）。
- GHCR 登录用内置 `GITHUB_TOKEN`（`packages: write`）；私有镜像拉取由 Sealos 应用侧 imageRegistry 配置。
