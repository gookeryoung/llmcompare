/**
 * 释放端口：找出占用指定端口的进程并结束它。
 *
 * 场景：`pnpm start` 被强制中断后，node 子进程可能仍持有端口，
 * 再次启动就会撞上 EADDRINUSE。此时 `pnpm kill-port` 一键清场。
 *
 * 用法：node scripts/kill-port.mjs [端口]   （默认取 PORT 或 8787）
 */
import { execFileSync } from 'node:child_process';

const port = Number(process.argv[2] || process.env.PORT || 8787);

function listeners() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        const cols = line.trim().split(/\s+/);
        // 形如：TCP  127.0.0.1:8787  0.0.0.0:0  LISTENING  12345
        if (cols.length >= 5 && cols[0] === 'TCP' && cols[3] === 'LISTENING' && cols[1].endsWith(`:${port}`)) {
          pids.add(cols[4]);
        }
      }
      return [...pids];
    }
    const out = execFileSync('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
    return out.split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

const pids = listeners();
if (!pids.length) {
  console.log(`端口 ${port} 空闲，无需处理。`);
  process.exit(0);
}

console.log(`端口 ${port} 被以下进程占用：${pids.join(', ')}`);
let failed = 0;
for (const pid of pids) {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', pid, '/F', '/T'], { stdio: 'ignore' });
    else process.kill(Number(pid), 'SIGKILL');
    console.log(`  已结束 PID ${pid}`);
  } catch (err) {
    failed += 1;
    console.error(`  结束 PID ${pid} 失败：${err.message}`);
  }
}
process.exit(failed ? 1 : 0);
