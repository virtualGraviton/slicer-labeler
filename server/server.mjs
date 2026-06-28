import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { apiMiddleware, getLabelerPaths } from './api.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const DIST_ROOT = path.join(APP_ROOT, 'dist');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
};

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function isInside(parent, target) {
  const relative = path.relative(parent, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveStaticPath(requestPath) {
  const decoded = decodeURIComponent(requestPath);
  const candidate = path.resolve(DIST_ROOT, `.${decoded}`);
  if (!isInside(DIST_ROOT, candidate)) return null;
  return candidate;
}

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let filePath = resolveStaticPath(url.pathname);
  if (!filePath) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    const hasExtension = path.extname(filePath) !== '';
    filePath = hasExtension ? filePath : path.join(DIST_ROOT, 'index.html');
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    apiMiddleware(req, res, () => {
      sendJson(res, 404, { error: 'API route not found' });
    });
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  const paths = getLabelerPaths();
  console.log(`Slicer Labeler listening on http://${HOST}:${PORT}`);
  console.log(`Data root: ${paths.dataRoot}`);
  console.log(`List path: ${paths.listPath}`);
  console.log(`Quality cache: ${paths.qualityCachePath}`);
});
