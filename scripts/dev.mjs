/** 一键开发模式：同时拉起 API 服务与 Vite 开发服务器。 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const children = [];

function run(label, command, args, color) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', env: process.env });
  child.on('exit', (code) => {
    console.log(`\x1b[${color}m[${label}] 已退出 (code=${code})\x1b[0m`);
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

let exiting = false;
function shutdown(code = 0) {
  if (exiting) return;
  exiting = true;
  for (const c of children) {
    try {
      c.kill();
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => process.exit(code), 200);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
// 与 server/index.mjs、web/vite.config.ts 共用同一套端口变量，可被 make dev 覆盖
const apiPort = process.env.PORT || '8787';
const webPort = process.env.WEB_PORT || '5173';
const webHost = process.env.WEB_HOST || '127.0.0.1';
process.env.PORT = apiPort;
process.env.WEB_PORT = webPort;
process.env.WEB_HOST = webHost;
run('api', process.execPath, ['server/index.mjs'], '36');
run('web', npx, ['vite', '--config', 'web/vite.config.ts'], '35');
console.log(`\n  API  : http://127.0.0.1:${apiPort}`);
console.log(`  Web  : http://${webHost}:${webPort}  (开发模式，带热更新)\n`);
