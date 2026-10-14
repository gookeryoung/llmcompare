/**
 * 推送当前分支与标签到所有已配置的远程仓库。
 *
 * 用法：node scripts/push.mjs [远程名...]   （不传则推送到全部远程）
 */
import { execFileSync } from 'node:child_process';

const run = (args) => execFileSync('git', args, { stdio: 'inherit' });

const remotes = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const list = remotes.length
  ? remotes
  : execFileSync('git', ['remote'], { encoding: 'utf8' })
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

if (!list.length) {
  console.error('没有配置任何 git 远程仓库。');
  process.exit(1);
}

const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();

let failed = 0;
for (const remote of list) {
  try {
    console.log(`\n推送 ${branch} -> ${remote} ...`);
    run(['push', remote, branch]);
    run(['push', remote, '--tags']);
  } catch {
    failed += 1;
    console.error(`推送到 ${remote} 失败。`);
  }
}

console.log(failed ? `\n完成，${failed}/${list.length} 个远程推送失败。` : `\n全部推送完成（${list.length} 个远程）。`);
process.exit(failed ? 1 : 0);
