/**
 * 环境体检：一条命令看清「能不能跑起来 / 能不能跑测试」。
 *
 * 用法：node scripts/doctor.mjs
 * 退出码：0 表示核心环境齐全（缺浏览器只是警告，不影响启动服务）
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { findChrome } from './lib/chrome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8787);

const results = [];
const add = (level, name, detail) => results.push({ level, name, detail });

/* ---- Node ---- */
const major = Number(process.versions.node.split('.')[0]);
const minor = Number(process.versions.node.split('.')[1]);
const nodeOk = major > 20 || (major === 20 && minor >= 19);
add(nodeOk ? 'ok' : 'fail', `Node.js ${process.versions.node}`, nodeOk ? '满足 >= 20.19' : '需要升级到 20.19 及以上');
add('ok', `平台 ${process.platform} ${process.arch}`, process.execPath);

/* ---- pnpm ---- */
try {
  // Windows 上 pnpm 是 .cmd/.ps1 包装脚本，execFile 无法直接执行，必须经 shell
  const v = execFileSync('pnpm --version', { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  add('ok', `pnpm ${v}`, '包管理器可用');
} catch {
  add('warn', 'pnpm 不可用', '可改用 npm run <script>，或 npm i -g pnpm');
}

/* ---- 依赖 ---- */
const hasDeps = fs.existsSync(path.join(ROOT, 'node_modules', 'vite'));
add(hasDeps ? 'ok' : 'fail', 'node_modules', hasDeps ? '依赖已安装' : '请先执行 pnpm install');

/* ---- 前端产物 ---- */
const distOk = fs.existsSync(path.join(ROOT, 'web', 'dist', 'index.html'));
add(distOk ? 'ok' : 'warn', 'web/dist', distOk ? '前端已构建' : '尚未构建，执行 pnpm build（UI 测试会自动构建）');

/* ---- 数据目录 ---- */
const dataDir = path.join(ROOT, 'data');
try {
  fs.mkdirSync(dataDir, { recursive: true });
  const probe = path.join(dataDir, '.doctor-probe');
  fs.writeFileSync(probe, 'ok');
  fs.rmSync(probe, { force: true });
  const models = path.join(dataDir, 'models.json');
  let detail = '可读写';
  if (fs.existsSync(models)) {
    const list = JSON.parse(fs.readFileSync(models, 'utf8'));
    detail += `，已配置 ${Array.isArray(list) ? list.length : 0} 个模型`;
  }
  add('ok', `data/`, detail);
} catch (err) {
  add('fail', 'data/', `不可写：${err.message}`);
}

/* ---- 端口 ---- */
const portFree = await new Promise((resolve) => {
  const srv = net.createServer();
  srv.once('error', () => resolve(false));
  srv.listen(PORT, '127.0.0.1', () => srv.close(() => resolve(true)));
});
add(portFree ? 'ok' : 'warn', `端口 ${PORT}`, portFree ? '空闲' : '已被占用，可用 pnpm kill-port 释放');

/* ---- 浏览器（UI 测试用）---- */
const chrome = findChrome();
add(chrome ? 'ok' : 'warn', '无头浏览器', chrome || '未找到 Chrome/Edge，pnpm test:ui 会被跳过；可用 CHROME_PATH 指定');

/* ---- 输出 ---- */
const icon = { ok: '✓', warn: '!', fail: '✗' };
const color = { ok: '\u001b[32m', warn: '\u001b[33m', fail: '\u001b[31m' };
const width = results.reduce((w, r) => Math.max(w, r.name.length), 0);
console.log('\nAI 模型工作台 · 环境体检\n');
for (const r of results) {
  console.log(`  ${color[r.level]}${icon[r.level]}\u001b[0m ${r.name.padEnd(width + 2)}${r.detail}`);
}
const failed = results.filter((r) => r.level === 'fail').length;
console.log(`\n${failed ? `✗ ${failed} 项阻塞` : '✓ 核心环境就绪'}\n`);
process.exit(failed ? 1 : 0);
