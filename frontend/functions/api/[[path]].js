// Cloudflare Pages Function — /api/* 同源反代到后端。
//
// 背景：Cloudflare Pages 的 _redirects 只支持站内 200 重写，不能代理外部域名
// （https://developers.cloudflare.com/pages/configuration/redirects/#proxying）。
// 所以改用 Pages Functions（运行在 Workers 上）实现真正的服务端反向代理：
// 浏览器始终访问 slice.fenglai.xyz，同源无跨域。
//
// 部署：本文件位于 frontend/functions/，Cloudflare Pages 构建时自动识别打包，
// 无需写进 dist。若后端域名变化，改 BACKEND_ORIGIN 即可（也可换成环境变量）。

const BACKEND_ORIGIN = 'https://labeler.fenglai.xyz';

export async function onRequest({ request, params }) {
  const url = new URL(request.url);
  const rest = (params.path || []).map(encodeURIComponent).join('/');
  const target = new URL(`${BACKEND_ORIGIN}/api/${rest}`);
  target.search = url.search; // 保留 ?token=... 等查询参数（SSE / 音频用）

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('content-length'); // 流式 body 时长度由 fetch 重新计算

  const resp = await fetch(target, {
    method: request.method,
    headers,
    body: request.body,
    redirect: 'manual', // 不跟随后端的 302（如跳转 GitHub 授权），原样返回给浏览器
  });

  // 透传状态码与响应头（含 Set-Cookie，OAuth state cookie 依赖它）
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: resp.headers,
  });
}
