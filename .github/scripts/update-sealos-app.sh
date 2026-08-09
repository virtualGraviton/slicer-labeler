#!/usr/bin/env bash
#
# 通过 Sealos App Launchpad v2alpha API 更新应用镜像并等待就绪。
# 从 deploy-e2e-test 测试仓验证后移植到生产仓库。
#
# 必需环境变量:
#   SEALOS_API_URL   如 https://applaunchpad.bja.sealos.run/api/v2alpha/apps
#   APP_NAME         Launchpad 应用名，如 slicer-labeler-backend
#   FULL_IMAGE       完整镜像名，如 ghcr.io/<owner>/slicer-labeler:sha-<sha>
#   KUBECONFIG_B64   Sealos kubeconfig 的 base64（URL-encode 后作为 Authorization 头）
#
set -euo pipefail

: "${SEALOS_API_URL:?SEALOS_API_URL required}"
: "${APP_NAME:?APP_NAME required}"
: "${FULL_IMAGE:?FULL_IMAGE required}"
: "${KUBECONFIG_B64:?KUBECONFIG_B64 required}"

API="${SEALOS_API_URL}/${APP_NAME}"

echo "=== 1/4 构造鉴权头 (kubeconfig URL-encode) ==="
echo "${KUBECONFIG_B64}" | base64 -d > /tmp/sealos-kubeconfig
TOKEN=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$(cat /tmp/sealos-kubeconfig)")
rm -f /tmp/sealos-kubeconfig
echo "token ready (${#TOKEN} chars)"

echo "=== 2/4 读取当前应用配置: GET ${API} ==="
HTTP=$(curl -s -w "%{http_code}" -o /tmp/app_current.json \
  -H "Authorization: ${TOKEN}" \
  -H "Content-Type: application/json" \
  "${API}" || true)
if [ "${HTTP}" != "200" ]; then
  echo "ERROR: GET ${APP_NAME} -> HTTP ${HTTP}"
  cat /tmp/app_current.json 2>/dev/null || true
  exit 1
fi
echo "current image: $(jq -r '.image.imageName' /tmp/app_current.json)"
echo "public address: $(jq -r '.ports[0].publicAddress // "-"' /tmp/app_current.json)"

echo "=== 3/4 更新镜像为 ${FULL_IMAGE} 并 PATCH ==="
# v2alpha PATCH 为部分更新语义：只提交 image 字段，quota/env/ports/storage 等不传则保留原值
jq -n --arg img "${FULL_IMAGE}" '{image: {imageName: $img}}' > /tmp/app_new.json
HTTP=$(curl -s -w "%{http_code}" -o /tmp/app_update.json \
  -X PATCH \
  -H "Authorization: ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d @/tmp/app_new.json \
  "${API}" || true)
if [ "${HTTP}" -ge 400 ]; then
  echo "ERROR: PATCH ${APP_NAME} -> HTTP ${HTTP}"
  cat /tmp/app_update.json 2>/dev/null || true
  exit 1
fi
echo "PATCH OK (HTTP ${HTTP})"

echo "=== 4/4 等待应用就绪 (status=running, 最多 10 分钟) ==="
for i in $(seq 1 60); do
  sleep 10
  STATUS=$(curl -s --max-time 15 \
    -H "Authorization: ${TOKEN}" \
    -H "Content-Type: application/json" \
    "${API}" | jq -r '.status // "unknown"')
  echo "[$((i * 10))s] status=${STATUS}"
  case "${STATUS}" in
    running) echo "APP RUNNING (ready)"
             exit 0 ;;
    error|pause) echo "ERROR: app status=${STATUS} (error|pause)"
             exit 1 ;;
    *) : ;; # creating/waiting/unknown 继续等待
  esac
done

echo "ERROR: 等待 ${APP_NAME} 就绪超时"
exit 1
