import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const E2E_PORT = process.env.E2E_PORT ?? '8790';
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
const DATA_DIR = path.join(ROOT, '.tmp', 'pw-e2e-data');

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : 2,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  globalSetup: './tests/e2e/global-setup.ts',

  // 一键起隔离后端：独立 DATA_DIR（.tmp/pw-e2e-data，globalSetup 清空重建），
  // 绝不复用外部服务。前端产物（web/dist）由 `make e2e` / `pnpm e2e` 的 build 前置负责。
  webServer: {
    command: `node ${path.join(ROOT, 'server', 'index.mjs')}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { PORT: E2E_PORT, HOST: '127.0.0.1', DATA_DIR },
  },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    browserName: 'chromium',
    headless: true,
  },
});
