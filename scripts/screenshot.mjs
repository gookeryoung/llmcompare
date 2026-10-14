/**
 * 生成文档用截图：驱动无头浏览器真实操作页面并截图到 docs/screenshots/。
 * 运行：node scripts/screenshot.mjs   （需要先启动服务：node server/index.mjs）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const PORT = 9334;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'docs', 'screenshots');
const WIDTH = 1600;
const HEIGHT = 1000;

const CHROME_CANDIDATES = [
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clickByText = (selector, text) => `(() => {
  const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
  const el = els.find((e) => (e.textContent || '').includes(${JSON.stringify(text)}));
  if (!el) return false;
  el.click();
  return true;
})()`;

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时: ${method}`));
        }
      }, 30000);
    });
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || '页面脚本异常');
    return r.result?.value;
  }

  async waitFor(expression, label, timeout = 30000) {
    const deadline = Date.now() + timeout;
    for (;;) {
      let v = false;
      try {
        v = await this.eval(expression);
      } catch {
        v = false;
      }
      if (v) return true;
      if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
      await sleep(200);
    }
  }

  async shot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = path.join(OUT_DIR, name);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(`  \u2713 已保存 ${path.relative(ROOT, file)}`);
  }
}

async function api(pathname, init) {
  const res = await fetch(BASE + pathname, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : null;
}

const chromePath = CHROME_CANDIDATES.find((p) => p && fs.existsSync(p));
if (!chromePath) {
  console.error('未找到 Chrome / Edge');
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const created = { models: [], runs: [], conversations: [] };
let child;
let cdp;

try {
  for (const [i, m] of [
    { name: '模拟模型 · 均衡', model: 'mock-balanced', mockFlavor: 'balanced', color: '#6366f1' },
    { name: '模拟模型 · 简洁', model: 'mock-concise', mockFlavor: 'concise', color: '#22d3ee' },
    { name: '模拟模型 · 详尽', model: 'mock-verbose', mockFlavor: 'verbose', color: '#34d399' },
  ].entries()) {
    const rec = await api('/api/models', {
      method: 'POST',
      body: JSON.stringify({ ...m, provider: 'mock', enabled: true, tags: ['示例'], pricing: { input: 1, output: 2 }, temperature: 0.7, maxTokens: 1024 }),
    });
    created.models.push(rec.id);
  }

  const userDataDir = path.join(os.tmpdir(), `dsh-shot-${Date.now()}`);
  child = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      `--window-size=${WIDTH},${HEIGHT}`,
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${userDataDir}`,
      `${BASE}/#/compare`,
    ],
    { stdio: 'ignore', windowsHide: true },
  );

  let wsUrl = '';
  for (let i = 0; i < 60 && !wsUrl; i += 1) {
    await sleep(400);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      wsUrl = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)?.webSocketDebuggerUrl || '';
    } catch {
      /* 等待浏览器 */
    }
  }
  if (!wsUrl) throw new Error('无法连接浏览器调试端口');

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')));
  });
  cdp = new CDP(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });

  console.log('\n开始截图…');

  await cdp.waitFor(`document.querySelectorAll('.model-pick').length >= 3`, '模型加载');
  await cdp.eval(`(() => {
    const el = document.querySelector('textarea.textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, '请用三点说明：为什么团队需要做多模型横向对比评测？每点不超过 40 字。');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(300);
  await cdp.eval(clickByText('button', '开始对比'));
  await cdp.waitFor(
    `[...document.querySelectorAll('.cmp-col')].length === 3 && [...document.querySelectorAll('.cmp-col')].every(c => c.innerText.includes('完成'))`,
    '对比完成',
    60000,
  );
  await sleep(400);

  // 打分 + 备注，让截图更接近真实使用
  await cdp.eval(`document.querySelectorAll('.cmp-col')[0].querySelectorAll('.stars .star')[4].click()`);
  await cdp.eval(`document.querySelectorAll('.cmp-col')[1].querySelectorAll('.stars .star')[3].click()`);
  await sleep(300);
  await cdp.shot('01-横向对比-并排.png');

  await cdp.eval(clickByText('button', '指标'));
  await cdp.waitFor(`document.body.innerText.includes('指标横向对比')`, '指标视图');
  await sleep(300);
  await cdp.shot('02-横向对比-指标.png');

  await cdp.eval(clickByText('button', '表格'));
  await sleep(400);
  await cdp.shot('03-横向对比-表格.png');

  await cdp.eval(clickByText('button', '并排'));
  await sleep(300);
  await cdp.eval(`(() => {
    const s = [...document.querySelectorAll('select.select')].find((x) => [...x.options].some((o) => o.textContent.includes('裁判模型')));
    const opt = [...s.options].find((o) => o.textContent.includes('模拟模型 · 均衡'));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(s, opt.value);
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(300);
  await cdp.eval(clickByText('button', 'AI 裁判'));
  await cdp.waitFor(`document.querySelectorAll('.rank-medal').length >= 3`, '裁判结果', 40000);
  await sleep(500);
  await cdp.shot('04-AI裁判.png');

  await cdp.eval(clickByText('button', '保存记录'));
  await sleep(1200);

  // 概览
  await cdp.eval(`window.location.hash = '#/dashboard'`);
  await cdp.waitFor(`document.body.innerText.includes('评测小贴士')`, '概览');
  await sleep(600);
  await cdp.shot('05-概览.png');

  // 模型接入
  await cdp.eval(`window.location.hash = '#/models'`);
  await cdp.waitFor(`document.body.innerText.includes('模拟模型 · 均衡')`, '模型列表');
  await sleep(500);
  await cdp.shot('06-模型接入.png');

  // 模型编辑弹窗
  await cdp.eval(`(() => {
    const cards = [...document.querySelectorAll('.card')];
    const card = cards.find((c) => c.textContent.includes('模拟模型 · 均衡'));
    const btn = [...card.querySelectorAll('button')].find((b) => b.title === '编辑');
    btn.click();
    return true;
  })()`);
  await cdp.waitFor(`document.body.innerText.includes('服务商预置')`, '模型编辑器');
  await sleep(500);
  await cdp.shot('07-模型接入-编辑.png');
  await cdp.eval(clickByText('.modal-foot button', '取消'));
  await sleep(300);

  // 题库
  await cdp.eval(`window.location.hash = '#/questions'`);
  await cdp.waitFor(`document.body.innerText.includes('通用能力示例题库')`, '题库页');
  await sleep(500);
  await cdp.shot('08-题库管理.png');

  // 对话
  await cdp.eval(`window.location.hash = '#/chat'`);
  await cdp.waitFor(`document.body.innerText.includes('开始一段新对话')`, '对话页');
  await cdp.eval(clickByText('button', '新建对话'));
  await cdp.waitFor(`!!document.querySelector('.composer textarea')`, '输入框');
  await cdp.eval(`(() => {
    const el = document.querySelector('.composer textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, '请用一句话解释「首字延迟（TTFT）」为什么重要。');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(200);
  await cdp.eval(clickByText('button', '发送'));
  await cdp.waitFor(`/ms|s\\b/.test(document.querySelector('.msg-head')?.innerText || '')`, '对话完成', 40000);
  await sleep(600);
  await cdp.shot('09-对话.png');
  const convs = await api('/api/conversations');
  if (convs[0]) created.conversations.push(convs[0].id);

  // 评测记录
  await cdp.eval(`window.location.hash = '#/runs'`);
  await cdp.waitFor(`document.querySelectorAll('.list-item').length > 0`, '记录列表');
  await cdp.eval(`document.querySelector('.list-item').click()`);
  await cdp.waitFor(`document.body.innerText.includes('AI 裁判')`, '记录详情');
  await sleep(600);
  await cdp.shot('10-评测记录.png');
  const runs = await api('/api/runs');
  runs.slice(0, 3).forEach((r) => created.runs.push(r.id));

  console.log('\n截图完成。');
} catch (err) {
  console.error(`\n截图失败：${err?.message || err}`);
  process.exitCode = 1;
} finally {
  try {
    for (const id of created.runs) await fetch(`${BASE}/api/runs/${id}`, { method: 'DELETE' });
    for (const id of created.conversations) await fetch(`${BASE}/api/conversations/${id}`, { method: 'DELETE' });
    for (const id of created.models) await fetch(`${BASE}/api/models/${id}`, { method: 'DELETE' });
  } catch {
    /* ignore */
  }
  try {
    cdp?.ws.close();
  } catch {
    /* ignore */
  }
  try {
    child?.kill();
  } catch {
    /* ignore */
  }
}
