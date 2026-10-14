/**
 * 无头浏览器定位与启动参数（跨平台）。
 *
 * 之所以单独抽出来：UI 测试脚本要在本地（Windows）与 CI（Linux）都能找到浏览器，
 * 且容器内必须追加 --no-sandbox。定位顺序为：
 *   1. 环境变量 CHROME_PATH / PUPPETEER_EXECUTABLE_PATH（CI 显式指定）
 *   2. 各平台常见安装路径
 */
import fs from 'node:fs';

const CANDIDATES = {
  win32: [
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env['ProgramFiles']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ],
};

/** 返回可用的浏览器可执行文件绝对路径；找不到时返回空串。 */
export function findChrome() {
  const fromEnv = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  ].find((p) => p && fs.existsSync(p));
  if (fromEnv) return fromEnv;

  const list = CANDIDATES[process.platform] || [];
  return list.find((p) => p && fs.existsSync(p)) || '';
}

/** 组装无头浏览器命令行参数。 */
export function chromeArgs({ port, userDataDir, width, height, url, extra = [] } = {}) {
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-translate',
    '--metrics-recording-only',
    '--mute-audio',
  ];
  if (port) args.push(`--remote-debugging-port=${port}`);
  if (userDataDir) args.push(`--user-data-dir=${userDataDir}`);
  if (width && height) args.push(`--window-size=${width},${height}`);
  // GitHub Actions / 容器内以 root 运行，Chromium 沙箱不可用
  if (process.env.CI) args.push('--no-sandbox', '--disable-dev-shm-usage');
  args.push(...extra);
  if (url) args.push(url);
  return args;
}
