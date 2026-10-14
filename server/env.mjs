/**
 * 极简 .env 加载器（零依赖）。
 *
 * 为什么不用 Node 自带的 --env-file：
 *   --env-file 需要 20.6+，而 --env-file-if-exists 要到 22.9+，
 *   本项目的 engines 只要求 >= 20.19，用自带参数会在 20.x 上直接启动失败。
 *
 * 支持：KEY=VALUE、# 注释、空行、值两侧的单/双引号。
 * 规则：**不覆盖已存在的环境变量**，即 shell 里显式传入的值永远优先。
 */
import fs from 'node:fs';

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function loadEnv(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return 0; // 没有 .env 是正常情况
  }

  let applied = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    if (!KEY_RE.test(key)) continue;

    let value = line.slice(eq + 1).trim();
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
      applied += 1;
    }
  }
  return applied;
}
