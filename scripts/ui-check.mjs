/**
 * 浏览器端 UI 验证：通过 Chrome DevTools Protocol 真实驱动页面，
 * 覆盖「模型接入 / 对话 / 题库 / 横向对比 / AI 裁判 / 评测记录」的核心交互。
 *
 * 运行：pnpm run test:ui
 *   —— 由 scripts/with-server.mjs 拉起隔离实例（独立端口 + .tmp/e2e-data），
 *      通过环境变量 BASE 注入地址；直接 `node scripts/ui-check.mjs` 则打默认 :8787。
 * 会自动创建测试数据并在结束后清理。
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { findChrome, chromeArgs } from './lib/chrome.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const PORT = Number(process.env.CDP_PORT || 9333);

let pass = 0;
let fail = 0;
const ok = (n, e = '') => {
  pass += 1;
  console.log(`  \u2713 ${n}${e ? `  ${e}` : ''}`);
};
const bad = (n, e) => {
  fail += 1;
  console.log(`  \u2717 ${n}  ->  ${e?.message || e}`);
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
async function check(name, fn) {
  try {
    ok(name, (await fn()) || '');
  } catch (err) {
    bad(name, err);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, init) {
  const res = await fetch(BASE + path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : null;
}

/* ------------------------- 极简 CDP 客户端 ------------------------- */

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
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || '页面脚本异常');
    }
    return r.result?.value;
  }

  async waitFor(expression, label, timeout = 25000) {
    const deadline = Date.now() + timeout;
    for (;;) {
      let v;
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
}

const clickByText = (selector, text) => `(() => {
  const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
  const el = els.find((e) => (e.textContent || '').includes(${JSON.stringify(text)}));
  if (!el) return false;
  el.click();
  return true;
})()`;

/* ------------------------------ 主流程 ------------------------------ */

const chromePath = findChrome();
if (!chromePath) {
  console.error('未找到可用的 Chrome / Edge，跳过 UI 验证。可用 CHROME_PATH 显式指定。');
  process.exit(0);
}

const created = { models: [], bankId: '', runIds: [], conversations: [] };
let child;
let cdp;

async function cleanup() {
  try {
    for (const id of created.runIds) await fetch(`${BASE}/api/runs/${id}`, { method: 'DELETE' });
    for (const id of created.conversations) await fetch(`${BASE}/api/conversations/${id}`, { method: 'DELETE' });
    for (const id of created.models) await fetch(`${BASE}/api/models/${id}`, { method: 'DELETE' });
    if (created.bankId) await fetch(`${BASE}/api/banks/${created.bankId}`, { method: 'DELETE' });
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

try {
  console.log(`\nUI 验证 -> ${BASE}  (浏览器: ${path.basename(chromePath)})\n`);

  /* 准备数据 */
  for (const [i, m] of [
    { name: 'UI测试·模型A', model: 'mock-balanced', mockFlavor: 'balanced' },
    { name: 'UI测试·模型B', model: 'mock-concise', mockFlavor: 'concise' },
    { name: 'UI测试·模型C', model: 'mock-verbose', mockFlavor: 'verbose' },
  ].entries()) {
    const created1 = await api('/api/models', {
      method: 'POST',
      body: JSON.stringify({ ...m, provider: 'mock', tags: ['ui'], color: ['#6366f1', '#22d3ee', '#34d399'][i] }),
    });
    created.models.push(created1.id);
  }
  const bank = await api('/api/banks', { method: 'POST', body: JSON.stringify({ name: 'UI 测试题库', description: 'ui' }) });
  created.bankId = bank.id;
  await api('/api/questions', {
    method: 'POST',
    body: JSON.stringify({ bankId: bank.id, title: 'UI 题目', content: '请用三点说明多模型对比评测的价值。', tags: ['ui'], difficulty: 'easy', rubric: '三点清晰' }),
  });

  /* 启动浏览器 */
  const userDataDir = path.join(os.tmpdir(), `dsh-ui-check-${Date.now()}`);
  child = spawn(
    chromePath,
    chromeArgs({ port: PORT, userDataDir, width: 1600, height: 1000, url: `${BASE}/#/compare` }),
    { stdio: 'ignore', windowsHide: true },
  );

  let wsUrl = '';
  for (let i = 0; i < 60; i += 1) {
    await sleep(400);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) {
        wsUrl = page.webSocketDebuggerUrl;
        break;
      }
    } catch {
      /* 浏览器尚未就绪 */
    }
  }
  assert(wsUrl, '无法连接浏览器调试端口');

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')));
  });
  cdp = new CDP(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  console.log('[1] 应用加载');
  await check('页面挂载成功（Sidebar 渲染）', async () => {
    await cdp.waitFor(`!!document.querySelector('.sidebar .nav-item')`, '侧边栏渲染');
    const title = await cdp.eval(`document.querySelector('.brand-name')?.textContent || ''`);
    assert(title.includes('模型工作台'), `标题异常: ${title}`);
  });
  await check('顶部标题为「横向对比」', async () => {
    const t = await cdp.eval(`document.querySelector('.page-title')?.textContent || ''`);
    assert(t === '横向对比', `实际: ${t}`);
  });
  await check('模型多选卡片渲染出本次测试的模型', async () => {
    await cdp.waitFor(`document.querySelectorAll('.model-pick').length >= 3`, '模型卡片');
    const names = await cdp.eval(`[...document.querySelectorAll('.model-pick')].map(e=>e.textContent).join('|')`);
    assert(names.includes('UI测试·模型A') && names.includes('UI测试·模型B'), '模型名称缺失');
    return `共 ${await cdp.eval(`document.querySelectorAll('.model-pick').length`)} 个可选模型`;
  });
  await check('只勾选本次测试的 3 个模型（与既有数据隔离）', async () => {
    // 不依赖「默认全选」：显式把选择收敛到本次创建的三条，避免受使用者已有模型影响
    await cdp.eval(`(() => {
      for (const p of [...document.querySelectorAll('.model-pick')]) {
        const mine = /UI测试·模型[ABC]/.test(p.textContent);
        const cb = p.querySelector('input[type=checkbox]');
        if (cb && cb.checked !== mine) cb.click();
      }
      return true;
    })()`);
    await sleep(500);
    const on = await cdp.eval(`[...document.querySelectorAll('.model-pick.on')].map((p) => p.textContent.replace(/\\s+/g, ' ').trim().slice(0, 16))`);
    assert(on.length === 3, `期望选中 3 个，实际 ${on.length}：${on.join(' / ')}`);
    return on.join(' / ');
  });

  console.log('\n[2] 引擎：填写问题并开始对比');
  await check('从题库下拉选择题目', async () => {
    const okBank = await cdp.eval(`(() => {
      const selects = [...document.querySelectorAll('select.select')];
      const target = selects.find((s) => [...s.options].some((o) => o.textContent.includes('UI 测试题库')));
      if (!target) return false;
      const opt = [...target.options].find((o) => o.textContent.includes('UI 测试题库'));
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(target, opt.value);
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    assert(okBank, '未找到题库下拉');
    await sleep(600);
    const okSel = await cdp.eval(`(() => {
      const selects = [...document.querySelectorAll('select.select')];
      const target = selects.find((s) => [...s.options].some((o) => o.textContent.includes('UI 题目')));
      if (!target) return false;
      const opt = [...target.options].find((o) => o.textContent.includes('UI 题目'));
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(target, opt.value);
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    assert(okSel, '未找到题目下拉');
    await sleep(500);
    const val = await cdp.eval(`document.querySelector('textarea.textarea')?.value || ''`);
    assert(val.includes('多模型对比评测'), `题干未填充: ${val.slice(0, 40)}`);
    return '题干已自动填充';
  });
  await check('点击「开始对比」', async () => {
    const clicked = await cdp.eval(clickByText('button', '开始对比'));
    assert(clicked, '未找到开始对比按钮');
  });
  await check('三个模型列并行流式渲染', async () => {
    await cdp.waitFor(`document.querySelectorAll('.cmp-col').length === 3`, '三列结果', 15000);
    const n = await cdp.eval(`document.querySelectorAll('.cmp-col').length`);
    assert(n === 3, `列数 ${n}`);
    const hasBody = await cdp.eval(`[...document.querySelectorAll('.cmp-col .cmp-body')].length === 3`);
    assert(hasBody, '结果列结构不完整');
  });
  await check('流式输出最终完成（状态=完成）', async () => {
    await cdp.waitFor(
      `[...document.querySelectorAll('.cmp-col')].length === 3 && [...document.querySelectorAll('.cmp-col')].every(c => c.innerText.includes('完成'))`,
      '全部完成',
      60000,
    );
    return `${await cdp.eval(`document.querySelectorAll('.cmp-col').length`)} 列全部完成`;
  });
  await check('指标区渲染出首字/耗时/Token/成本', async () => {
    const text = await cdp.eval(`document.querySelector('.cmp-col .cmp-head').textContent`);
    for (const k of ['首字', '耗时', '输出 Tokens', '速度', '总 Tokens', '预估成本']) {
      assert(text.includes(k), `缺少指标 ${k}`);
    }
    assert(/ms|s\b/.test(text), '指标没有数值');
  });
  await check('回答正文已渲染且非空', async () => {
    const lens = await cdp.eval(`[...document.querySelectorAll('.cmp-col .cmp-body')].map(e=>e.innerText.length)`);
    assert(lens.length === 3, `结果列数量 ${lens.length}`);
    assert(lens.every((n) => n > 30), `正文过短: ${lens.join('/')}`);
    return `字数 ${lens.join(' / ')}`;
  });

  console.log('\n[3] 评分与 AI 裁判');
  await check('人工星级评分可点击', async () => {
    const okStar = await cdp.eval(`(() => {
      const stars = document.querySelectorAll('.cmp-col .stars .star');
      if (stars.length < 4) return false;
      stars[3].click();
      return true;
    })()`);
    assert(okStar, '未找到评分星');
    await sleep(300);
    const on = await cdp.eval(`document.querySelectorAll('.cmp-col .stars .star.on').length`);
    assert(on >= 4, `点亮 ${on} 颗`);
    return `${on} 星`;
  });
  await check('填写备注', async () => {
    const okNote = await cdp.eval(`(() => {
      const input = document.querySelector('.cmp-col input.input-sm');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'UI 自动化备注');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    assert(okNote, '未找到备注输入框');
    await sleep(200);
    const v = await cdp.eval(`document.querySelector('.cmp-col input.input-sm')?.value`);
    assert(v === 'UI 自动化备注', '备注未生效');
  });
  await check('AI 裁判返回评分并回填各列', async () => {
    const sel = await cdp.eval(`(() => {
      const s = [...document.querySelectorAll('select.select')].find((x) => [...x.options].some((o) => o.textContent.includes('裁判模型')));
      if (!s) return false;
      const opt = [...s.options].find((o) => o.textContent.includes('UI测试·模型A'));
      if (!opt) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(s, opt.value);
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    assert(sel, '未找到裁判模型下拉');
    await sleep(300);
    const clicked = await cdp.eval(clickByText('button', 'AI 裁判'));
    assert(clicked, '未找到 AI 裁判按钮');
    await cdp.waitFor(`document.body.innerText.includes('AI 裁判结果')`, '裁判面板', 30000);
    await cdp.waitFor(`document.querySelectorAll('.rank-medal').length >= 3`, '裁判排名', 30000);
    const scores = await cdp.eval(`[...document.querySelectorAll('.cmp-col')].map(c => (c.innerText.match(/裁判\\s*([\\d.]+)/) || [])[1] || '-').join('/')`);
    assert(!scores.split('/').every((s) => s === '-'), '各列未回填裁判分数');
    return `裁判分 ${scores}`;
  });

  console.log('\n[4] 视图切换与导出');
  await check('切换到指标视图', async () => {
    const clicked = await cdp.eval(clickByText('button', '指标'));
    assert(clicked, '未找到指标按钮');
    await cdp.waitFor(`document.body.innerText.includes('指标横向对比')`, '指标面板');
    const bars = await cdp.eval(`document.querySelectorAll('.bar-track').length`);
    assert(bars > 0, '没有渲染对比条');
    return `${bars} 条对比条`;
  });
  await check('切换到表格视图', async () => {
    await cdp.eval(clickByText('button', '表格'));
    await cdp.waitFor(`!!document.querySelector('table.table tbody tr')`, '表格');
    const rows = await cdp.eval(`document.querySelectorAll('table.table tbody tr').length`);
    assert(rows >= 3, `表格行数 ${rows}`);
    return `${rows} 行`;
  });
  await check('切回并排视图', async () => {
    await cdp.eval(clickByText('button', '并排'));
    await cdp.waitFor(`document.querySelectorAll('.cmp-col').length === 3`, '并排视图');
  });
  await check('保存评测记录', async () => {
    await cdp.eval(clickByText('button', '保存记录'));
    await cdp.waitFor(`document.body.innerText.includes('评测记录已保存')`, '保存成功提示', 15000);
    const runs = await api('/api/runs');
    const mine = runs.filter((r) => (r.question || '').includes('多模型对比评测'));
    assert(mine.length >= 1, '服务端没有对应记录');
    created.runIds.push(mine[0].id);
    return `已保存：${mine[0].title.slice(0, 24)}`;
  });

  console.log('\n[5] 评测记录页');
  await check('打开评测记录并展示详情', async () => {
    await cdp.eval(`window.location.hash = '#/runs'`);
    await cdp.waitFor(`document.body.innerText.includes('选择一条评测记录') || document.querySelectorAll('.list-item').length > 0`, '记录列表', 15000);
    await cdp.waitFor(`document.querySelectorAll('.list-item').length > 0`, '列表项', 15000);
    await cdp.eval(`document.querySelector('.list-item').click()`);
    await cdp.waitFor(`document.body.innerText.includes('AI 裁判')`, '记录详情', 15000);
    const hasCols = await cdp.eval(`document.querySelectorAll('.cmp-col').length`);
    assert(hasCols >= 1, '详情未渲染结果列');
    return `${hasCols} 列结果`;
  });

  console.log('\n[6] 对话页');
  await check('新建对话并发送消息', async () => {
    await cdp.eval(`window.location.hash = '#/chat'`);
    await cdp.waitFor(`document.body.innerText.includes('开始一段新对话')`, '对话页', 15000);
    await cdp.eval(clickByText('button', '新建对话'));
    await cdp.waitFor(`!!document.querySelector('.composer textarea')`, '输入框', 15000);
    await cdp.eval(`(() => {
      const el = document.querySelector('.composer textarea');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, '你好，请用一句话介绍你自己。');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(200);
    await cdp.eval(clickByText('button', '发送'));
    await cdp.waitFor(`document.querySelectorAll('.msg').length >= 2`, '消息渲染', 20000);
    await cdp.waitFor(`!!document.querySelector('.msg .md')`, '助手回复', 30000);
    await cdp.waitFor(`/ms|s\\b/.test(document.querySelector('.msg-head')?.innerText || '')`, '指标出现', 30000);
    const text = await cdp.eval(`document.querySelector('.msg .md')?.innerText || ''`);
    assert(text.length > 20, `回复过短: ${text}`);
    const metas = await cdp.eval(`document.querySelector('.msg-head')?.innerText || ''`);
    assert(/ms|s/.test(metas), `缺少耗时指标: ${metas}`);
    const convs = await api('/api/conversations');
    if (convs[0]) created.conversations.push(convs[0].id);
    return `${text.length} 字，指标「${metas.replace(/\s+/g, ' ').slice(0, 40)}」`;
  });

  console.log('\n[7] 题库页');
  await check('题库列表与题目渲染', async () => {
    await cdp.eval(`window.location.hash = '#/questions'`);
    await cdp.waitFor(`document.body.innerText.includes('UI 测试题库')`, '题库列表', 15000);
    await cdp.eval(`(() => {
      const el = [...document.querySelectorAll('.list-item')].find((x) => x.textContent.includes('UI 测试题库'));
      if (!el) return false;
      el.click();
      return true;
    })()`);
    await cdp.waitFor(`document.body.innerText.includes('UI 题目')`, '题目列表', 15000);
  });
  await check('打开题目编辑弹窗', async () => {
    await cdp.eval(clickByText('button', '新增题目'));
    await cdp.waitFor(`document.body.innerText.includes('题干')`, '题目弹窗', 10000);
    const hasFields = await cdp.eval(`document.querySelectorAll('.modal textarea').length >= 3`);
    assert(hasFields, '编辑表单字段不完整');
    await cdp.eval(clickByText('.modal-foot button', '取消'));
    await cdp.waitFor(`!document.querySelector('.modal')`, '关闭弹窗', 8000);
  });

  console.log('\n[8] 模型接入页');
  await check('模型卡片与编辑器', async () => {
    await cdp.eval(`window.location.hash = '#/models'`);
    await cdp.waitFor(`document.body.innerText.includes('UI测试·模型A')`, '模型卡片', 15000);
    await cdp.eval(clickByText('button', '接入模型'));
    await cdp.waitFor(`document.body.innerText.includes('服务商预置')`, '编辑器', 10000);
    const presets = await cdp.eval(`[...document.querySelectorAll('.modal button')].filter(b=>/OpenAI|DeepSeek|Ollama|Anthropic/.test(b.textContent)).length`);
    assert(presets >= 4, `预置数量 ${presets}`);
    await cdp.eval(clickByText('.modal button', 'OpenRouter'));
    await sleep(300);
    const url = await cdp.eval(`document.querySelector('.modal input.mono')?.value || ''`);
    assert(url.includes('openrouter.ai'), `预置未回填地址: ${url}`);
    await cdp.eval(clickByText('.modal-foot button', '取消'));
    return `${presets} 个预置服务商`;
  });

  console.log('\n[9] 主题与响应式');
  await check('切换到浅色主题', async () => {
    const clicked = await cdp.eval(clickByText('.sidebar button', '切换到浅色'));
    assert(clicked, '未找到主题按钮');
    await sleep(400);
    const theme = await cdp.eval(`document.documentElement.dataset.theme`);
    assert(theme === 'light', `实际主题 ${theme}`);
    await cdp.eval(clickByText('.sidebar button', '切换到深色'));
    await sleep(300);
    return '深/浅色切换正常';
  });
  await check('窄屏下侧边栏收起为图标栏', async () => {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 820, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    const width = await cdp.eval(`document.querySelector('.sidebar').getBoundingClientRect().width`);
    assert(width < 100, `侧边栏宽度 ${width}`);
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    return `宽度 ${Math.round(width)}px`;
  });
  await check('控制台无 React 报错', async () => {
    const errs = await cdp.eval(`window.__uiErrors ? window.__uiErrors.length : 0`);
    assert(!errs, `捕获到 ${errs} 条错误`);
  });
} catch (err) {
  fail += 1;
  console.error(`\n执行中断：${err?.message || err}`);
} finally {
  await cleanup();
}

console.log(`\nUI 验证结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
