/**
 * 渲染 Makefile 中的 `## ` 注释为命令列表（`make help` 使用）。
 *
 * 之所以独立成文件而不是塞进 Makefile 的单行命令：正则里的 `$`、引号与反斜杠
 * 在 make → shell 两层转义后极易出错，放进 .mjs 后跨平台、可调试。
 *
 * 用法：node scripts/help.mjs <Makefile...>
 */
import fs from 'node:fs';

const rows = [];

for (const file of process.argv.slice(2)) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  for (const line of text.split(/\r?\n/)) {
    // 配方行以制表符开头，不可能定义目标
    if (!line || line.startsWith('\t') || line.startsWith('#')) continue;

    const colon = line.indexOf(':');
    if (colon <= 0) continue;

    // 左侧为「主目标 [别名...]」，必须以字母开头才能排除 .PHONY / 变量赋值
    const names = line.slice(0, colon).trim();
    if (!/^[a-zA-Z][\w -]*$/.test(names)) continue;

    const rest = line.slice(colon + 1);
    const hash = rest.indexOf('##');
    if (hash < 0) continue;

    const desc = rest.slice(hash + 2).trim();
    if (desc && !rows.some(([n]) => n === names)) rows.push([names, desc]);
  }
}

const width = rows.reduce((w, [n]) => Math.max(w, n.length), 0);
process.stdout.write('AI 模型工作台 · 可用命令\n\n');
for (const [names, desc] of rows) {
  process.stdout.write(`  ${names.padEnd(width + 2)}${desc}\n`);
}
process.stdout.write('\n');
