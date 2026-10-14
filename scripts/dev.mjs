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
run('api', process.execPath, ['server/index.mjs'], '36');
run('web', npx, ['vite', '--config', 'web/vite.config.ts'], '35');
console.log('\n  API  : http://127.0.0.1:8787');
console.log('  Web  : http://127.0.0.1:5173  (开发模式，带热更新)\n');
