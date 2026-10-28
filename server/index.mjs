/**
 * llmcompare —— 大模型对比分析平台，零依赖 HTTP 服务。
 * 同时提供：/api/* 接口 与 前端静态资源（web/dist）。
 */
import http from 'node:http';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';
import { createApi } from './api.mjs';
import { loadEnv } from './env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
// 先加载 .env（已存在的真实环境变量优先），再解析下面的配置项
loadEnv(path.join(ROOT, '.env'));
const WEB_DIST = path.join(ROOT, 'web', 'dist');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function safeJoin(base, target) {
  const resolved = path.resolve(base, `.${path.posix.normalize(`/${target}`)}`);
  return resolved.startsWith(base) ? resolved : null;
}

async function serveStatic(req, res, pathname) {
  let filePath = safeJoin(WEB_DIST, pathname);
  if (!filePath) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  let stat = await fsp.stat(filePath).catch(() => null);
  if (stat?.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    stat = await fsp.stat(filePath).catch(() => null);
  }
  if (!stat?.isFile()) {
    // SPA 回退
    filePath = path.join(WEB_DIST, 'index.html');
    stat = await fsp.stat(filePath).catch(() => null);
    if (!stat?.isFile()) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<h1>前端尚未构建</h1><p>请先执行 <code>npm run build</code>，或使用 <code>npm run dev</code> 启动开发模式。</p>`,
      );
      return;
    }
  }
  const ext = path.extname(filePath).toLowerCase();
  const etag = `W/"${stat.size}-${Number(stat.mtimeMs).toString(36)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304).end();
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': stat.size,
    etag,
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  fs.createReadStream(filePath).pipe(res);
}

const store = await new Store(DATA_DIR).init();
const handleApi = createApi(store);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  res.setHeader('x-content-type-options', 'nosniff');
  try {
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      const query = Object.fromEntries(url.searchParams.entries());
      const handled = await handleApi(req, res, pathname, query);
      if (handled) return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Method Not Allowed' }));
      return;
    }
    await serveStatic(req, res, pathname);
  } catch (err) {
    console.error('[server]', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err?.message || '服务器内部错误' }));
    } else {
      res.end();
    }
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ✗ 端口 ${PORT} 已被占用，服务无法启动。`);
    console.error(`    查看占用者：${process.platform === 'win32' ? `netstat -ano | findstr :${PORT}` : `lsof -iTCP:${PORT} -sTCP:LISTEN`}`);
    console.error(`    一键释放：  pnpm run kill-port   （或 make kill-port）`);
    console.error(`    换个端口：  PORT=8788 pnpm start\n`);
    process.exit(1);
  }
  if (err.code === 'EACCES') {
    console.error(`\n  ✗ 没有权限绑定 ${HOST}:${PORT}（1024 以下端口通常需要管理员权限）。\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`\n  llmcompare 已启动`);
  console.log(`  ➜  http://${HOST}:${PORT}`);
  console.log(`  ➜  数据目录: ${DATA_DIR}\n`);
});

async function shutdown() {
  console.log('\n  正在保存数据并退出…');
  await store.flushAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
