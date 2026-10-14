/**
 * 测试夹具：拉起一个**隔离**的服务实例跑指定命令，结束后回收。
 *
 * 隔离点有两个，缺一不可：
 *   1. 端口：临时占用一个空闲端口，避免撞上使用者正在跑的 `pnpm start`（:8787）；
 *   2. 数据目录：DATA_DIR 指向仓库内 .tmp/e2e-data，测试永远不会读写 data/ 下的真实配置与密钥。
 *
 * 用法：
 *   node scripts/with-server.mjs [--build] [--keep] <脚本.mjs> [参数...]
 *
 * 命令一律用当前 node 可执行文件运行；写成 `... node scripts/x.mjs` 也兼容（会自动去掉 node 前缀）。
 *
 * 环境变量：
 *   BASE  子进程可见，形如 http://127.0.0.1:53123
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP_DIR = path.join(ROOT, '.tmp');
const DATA_DIR = path.join(TMP_DIR, 'e2e-data');

const argv = process.argv.slice(2);
const build = argv.includes('--build');
const keep = argv.includes('--keep');
let command = argv.filter((a) => a !== '--build' && a !== '--keep' && a !== '--');
// 兼容 `with-server.mjs node scripts/x.mjs` 写法：命令始终由本进程的 node 执行
if (command.length && /^node(\.exe)?$/i.test(path.basename(command[0]))) command = command.slice(1);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function run(args, opts = {}) {
  return spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit', ...opts });
}

/** 等待 /api/health 就绪；服务端提前退出则立即失败。 */
async function waitHealthy(base, child, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let exited = null;
  child.once('exit', (code) => {
    exited = code;
  });
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`服务端提前退出（code=${exited}）`);
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch {
      /* 还没起来 */
    }
    await sleep(150);
  }
  throw new Error(`等待服务端就绪超时（${timeoutMs}ms）`);
}

async function terminate(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const done = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  await done;
  clearTimeout(timer);
}

let server;
let exitCode;

try {
  if (!command.length) {
    console.error('用法: node scripts/with-server.mjs [--build] [--keep] <命令> [参数...]');
    process.exit(2);
  }

  if (build) {
    console.log('[with-server] 构建前端产物（web/dist）...');
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'web/vite.config.ts'], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    if (r.status !== 0) throw new Error('前端构建失败');
  }

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;

  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log(`[with-server] 隔离实例 ${base}  DATA_DIR=${path.relative(ROOT, DATA_DIR)}`);
  server = run([path.join('server', 'index.mjs')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR },
  });
  server.on('error', (err) => {
    console.error('[with-server] 无法启动服务端:', err.message);
  });

  await waitHealthy(base, server);

  const child = run(command, { env: { ...process.env, BASE: base, PORT: String(port), DATA_DIR } });
  exitCode = await new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve(signal ? 1 : code ?? 0));
    child.once('error', (err) => {
      console.error('[with-server] 无法执行命令:', err.message);
      resolve(127);
    });
  });
} catch (err) {
  console.error(`[with-server] ${err?.message || err}`);
  exitCode = 1;
} finally {
  await terminate(server);
  if (!keep) {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    // .tmp 若已空则一并收掉，避免仓库里留下空目录（非空时 rmdir 会抛错，忽略即可）
    try {
      fs.rmdirSync(TMP_DIR);
    } catch {
      /* 还有别的临时内容，保留 */
    }
  } else {
    console.log(`[with-server] 保留数据目录：${path.relative(ROOT, DATA_DIR)}`);
  }
}

process.exit(exitCode);
