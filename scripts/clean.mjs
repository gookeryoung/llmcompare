/**
 * 清理构建产物与缓存。
 *
 * **绝不触碰 `data/`**：那里是使用者的模型配置、API Key、题库与评测记录。
 * 需要清空运行数据请手动删除，另见 `make clean-data` 的显式确认提示。
 *
 * 用法：node scripts/clean.mjs [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');

const TARGETS = [
  'web/dist',
  '.tmp',
  'coverage',
  'htmlcov',
  '.eslintcache',
  'node_modules/.cache',
  'node_modules/.vite',
];

let removed = 0;
let bytes = 0;

function sizeOf(p) {
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
    total += sizeOf(path.join(p, entry.name));
  }
  return total;
}

for (const rel of TARGETS) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  let size;
  try {
    size = sizeOf(abs);
  } catch {
    size = 0;
  }
  console.log(`${dryRun ? '[dry-run] 将删除' : '删除'} ${rel}  (${(size / 1024).toFixed(0)} KB)`);
  if (!dryRun) fs.rmSync(abs, { recursive: true, force: true });
  removed += 1;
  bytes += size;
}

// 截图脚本产生的临时裁切图
const shotsDir = path.join(ROOT, 'docs', 'screenshots');
if (fs.existsSync(shotsDir)) {
  for (const name of fs.readdirSync(shotsDir)) {
    if (!name.startsWith('_')) continue;
    const abs = path.join(shotsDir, name);
    console.log(`${dryRun ? '[dry-run] 将删除' : '删除'} docs/screenshots/${name}`);
    if (!dryRun) fs.rmSync(abs, { force: true });
    removed += 1;
  }
}

console.log(
  removed
    ? `\n清理完成：${removed} 项，约 ${(bytes / 1024 / 1024).toFixed(1)} MB。data/ 未改动。`
    : '\n没有需要清理的产物。',
);
