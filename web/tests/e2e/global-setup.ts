import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** 每轮 E2E 前清空并重建隔离数据目录，保证用例从全新种子数据开始 */
export default function globalSetup() {
  const dataDir = path.join(root, '.tmp', 'pw-e2e-data');
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
}
