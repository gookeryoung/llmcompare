/**
 * HTTP API 路由层（零依赖，手写极简路由器）。
 */
import { streamChat, listUpstreamModels, testConnection } from './adapters.mjs';
import { newId, nowIso } from './store.mjs';

/* ------------------------------ 基础工具 ------------------------------ */

function maskKey(key) {
  if (!key) return '';
  const s = String(key);
  if (s.length <= 8) return '••••';
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

function publicModel(m) {
  const { apiKey, ...rest } = m;
  return { ...rest, hasKey: Boolean(apiKey), apiKeyPreview: maskKey(apiKey) };
}

async function readBody(req, limit = 40 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('请求体过大'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON'), { status: 400 });
  }
}

function sendJson(res, status, data) {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store', ...extraHeaders });
  res.end(text);
}

function startSse(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(': stream open\n\n');
  let closed = false;
  res.on('close', () => {
    closed = true;
  });
  return {
    send(obj) {
      if (closed) return false;
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
      return true;
    },
    get closed() {
      return closed;
    },
    end() {
      if (closed) return;
      closed = true;
      res.end();
    },
  };
}

/* ------------------------------ CSV 工具 ------------------------------ */

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows, headers) {
  const head = headers.map((h) => csvEscape(h.label)).join(',');
  const body = rows.map((row) => headers.map((h) => csvEscape(row[h.key])).join(',')).join('\n');
  return `${head}\n${body}`;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}

/* ------------------------------ 路由实现 ------------------------------ */

export function createApi(store) {
  const routes = [];
  const on = (method, pattern, handler) => routes.push({ method, pattern, handler });

  const modelById = (id) => store.find('models', id);

  const resolveParams = (raw = {}, model = {}) => ({
    temperature: raw.temperature ?? model.temperature ?? store.settings.defaultParams.temperature,
    topP: raw.topP ?? model.topP ?? store.settings.defaultParams.topP,
    maxTokens: raw.maxTokens ?? model.maxTokens ?? store.settings.defaultParams.maxTokens,
  });

  const priceOf = (model, usage) => {
    const p = model?.pricing || {};
    const inRate = Number(p.input || 0);
    const outRate = Number(p.output || 0);
    if (!inRate && !outRate) return 0;
    return ((usage.promptTokens || 0) / 1e6) * inRate + ((usage.completionTokens || 0) / 1e6) * outRate;
  };

  /* ----------------------------- health ----------------------------- */
  on('GET', '/api/health', ({ res }) => sendJson(res, 200, { ok: true, time: nowIso() }));

  on('GET', '/api/bootstrap', ({ res }) => {
    sendJson(res, 200, {
      settings: store.settings,
      counts: {
        models: store.all('models').length,
        enabledModels: store.all('models').filter((m) => m.enabled !== false).length,
        conversations: store.all('conversations').length,
        banks: store.all('banks').length,
        questions: store.all('questions').length,
        runs: store.all('runs').length,
      },
    });
  });

  on('GET', '/api/settings', ({ res }) => sendJson(res, 200, store.settings));
  on('PUT', '/api/settings', ({ res, body }) => sendJson(res, 200, store.setSettings(body || {})));

  /* ------------------------------ models ---------------------------- */
  on('GET', '/api/models', ({ res }) => sendJson(res, 200, store.all('models').map(publicModel)));

  on('POST', '/api/models', ({ res, body }) => {
    if (!body?.name || !body?.model) throw Object.assign(new Error('缺少模型名称或模型 ID'), { status: 400 });
    const record = store.insert('models', {
      provider: 'openai',
      baseUrl: '',
      apiKey: '',
      enabled: true,
      tags: [],
      temperature: store.settings.defaultParams.temperature,
      topP: store.settings.defaultParams.topP,
      maxTokens: store.settings.defaultParams.maxTokens,
      pricing: { input: 0, output: 0 },
      ...body,
    });
    sendJson(res, 201, publicModel(record));
  });

  on('PUT', '/api/models/:id', ({ res, params, body }) => {
    const existing = modelById(params.id);
    if (!existing) throw Object.assign(new Error('模型不存在'), { status: 404 });
    const patch = { ...body };
    // 前端不回传明文 key 时保持原值
    if (patch.apiKey === undefined || patch.apiKey === null || patch.apiKey === '') delete patch.apiKey;
    const record = store.update('models', params.id, patch);
    sendJson(res, 200, publicModel(record));
  });

  on('DELETE', '/api/models/:id', ({ res, params }) => {
    if (!store.remove('models', params.id)) throw Object.assign(new Error('模型不存在'), { status: 404 });
    sendJson(res, 200, { ok: true });
  });

  on('POST', '/api/models/probe', async ({ res, body }) => {
    const models = await listUpstreamModels(body || {}, AbortSignal.timeout(20000));
    sendJson(res, 200, { models });
  });

  on('POST', '/api/models/test-config', async ({ res, body }) => {
    const result = await testConnection(body || {}, null, 30000);
    sendJson(res, 200, result);
  });

  on('POST', '/api/models/:id/test', async ({ res, params }) => {
    const model = modelById(params.id);
    if (!model) throw Object.assign(new Error('模型不存在'), { status: 404 });
    const result = await testConnection(model, null, 30000);
    store.update('models', params.id, { lastCheck: { at: nowIso(), ...result } });
    sendJson(res, 200, result);
  });

  /* --------------------------- conversations ------------------------ */
  on('GET', '/api/conversations', ({ res }) => {
    const list = store
      .all('conversations')
      .map((c) => ({
        id: c.id,
        title: c.title,
        modelId: c.modelId,
        messageCount: c.messages?.length || 0,
        preview: c.messages?.filter((m) => m.role === 'user').slice(-1)[0]?.content?.slice(0, 80) || '',
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    sendJson(res, 200, list);
  });

  on('POST', '/api/conversations', ({ res, body }) => {
    const record = store.insert('conversations', {
      title: '新对话',
      messages: [],
      systemPrompt: '',
      params: {},
      ...body,
    });
    sendJson(res, 201, record);
  });

  on('GET', '/api/conversations/:id', ({ res, params }) => {
    const conv = store.find('conversations', params.id);
    if (!conv) throw Object.assign(new Error('会话不存在'), { status: 404 });
    sendJson(res, 200, conv);
  });

  on('PUT', '/api/conversations/:id', ({ res, params, body }) => {
    const record = store.update('conversations', params.id, body || {});
    if (!record) throw Object.assign(new Error('会话不存在'), { status: 404 });
    sendJson(res, 200, record);
  });

  on('DELETE', '/api/conversations/:id', ({ res, params }) => {
    if (!store.remove('conversations', params.id)) throw Object.assign(new Error('会话不存在'), { status: 404 });
    sendJson(res, 200, { ok: true });
  });

  /* --------------------------- 流式转发核心 -------------------------- */

  async function pipeStream({ res, req, model, messages, params, onDone }) {
    const sse = startSse(res);
    const controller = new AbortController();
    req.on('close', () => controller.abort());
    const started = Date.now();
    let ttft = null;
    let text = '';
    let reasoning = '';
    let usage = { promptTokens: 0, completionTokens: 0 };
    let finish = '';
    let completionTokensEstimated = false;
    sse.send({ type: 'start', modelId: model.id, modelName: model.name, at: started });
    try {
      const opts = resolveParams(params, model);
      const iterable = streamChat(model, messages, opts, controller.signal);
      for await (const evt of iterable) {
        if (evt.type === 'delta') {
          if (ttft == null) ttft = Date.now() - started;
          text += evt.text;
          sse.send({ type: 'delta', text: evt.text });
        } else if (evt.type === 'reasoning') {
          reasoning += evt.text;
          sse.send({ type: 'reasoning', text: evt.text });
        } else if (evt.type === 'usage') {
          usage.promptTokens = Math.max(usage.promptTokens, evt.promptTokens || 0);
          usage.completionTokens = Math.max(usage.completionTokens, evt.completionTokens || 0);
        } else if (evt.type === 'finish') {
          finish = evt.reason || 'stop';
        }
      }
      // 上游未回传 usage 时按字符数粗估
      if (!usage.completionTokens && text) {
        usage.completionTokens = Math.max(1, Math.round(text.length / 1.7));
        completionTokensEstimated = true;
      }
      const completedAt = Date.now();
      const metrics = {
        latencyMs: completedAt - started,
        ttftMs: ttft,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        estimated: completionTokensEstimated,
        totalTokens: usage.promptTokens + usage.completionTokens,
        chars: text.length,
        charsPerSec: text.length ? Number((text.length / Math.max(1, completedAt - (started + (ttft || 0))) * 1000).toFixed(1)) : 0,
        cost: priceOf(model, usage),
        finishReason: finish || 'stop',
      };
      const result = { text, reasoning, metrics };
      if (onDone) onDone(result);
      sse.send({ type: 'done', metrics });
    } catch (err) {
      if (controller.signal.aborted) sse.send({ type: 'done', metrics: { aborted: true, latencyMs: Date.now() - started }, aborted: true });
      else sse.send({ type: 'error', message: err?.message || String(err), status: err?.status || 0 });
    } finally {
      sse.end();
    }
  }

  on('POST', '/api/chat/stream', async ({ req, res, body }) => {
    const model = modelById(body.modelId);
    if (!model) throw Object.assign(new Error('模型不存在'), { status: 404 });
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) throw Object.assign(new Error('消息为空'), { status: 400 });
    if (body.systemPrompt) messages.unshift({ role: 'system', content: body.systemPrompt });
    await pipeStream({ req, res, model, messages, params: body.params });
  });

  on('POST', '/api/run/stream', async ({ req, res, body }) => {
    const model = modelById(body.modelId);
    if (!model) throw Object.assign(new Error('模型不存在'), { status: 404 });
    const messages = [];
    if (body.systemPrompt) messages.push({ role: 'system', content: body.systemPrompt });
    messages.push({ role: 'user', content: String(body.question || '') });
    if (!messages[messages.length - 1].content.trim()) throw Object.assign(new Error('问题为空'), { status: 400 });
    await pipeStream({ req, res, model, messages, params: body.params });
  });

  /* ------------------------------ banks ----------------------------- */
  on('GET', '/api/banks', ({ res }) => {
    const banks = store.all('banks').map((b) => ({
      ...b,
      questionCount: store.all('questions').filter((q) => q.bankId === b.id).length,
    }));
    sendJson(res, 200, banks);
  });

  on('POST', '/api/banks', ({ res, body }) => {
    if (!body?.name) throw Object.assign(new Error('缺少题库名称'), { status: 400 });
    sendJson(res, 201, store.insert('banks', { description: '', color: '#6366f1', ...body }));
  });

  on('PUT', '/api/banks/:id', ({ res, params, body }) => {
    const record = store.update('banks', params.id, body || {});
    if (!record) throw Object.assign(new Error('题库不存在'), { status: 404 });
    sendJson(res, 200, record);
  });

  on('DELETE', '/api/banks/:id', ({ res, params }) => {
    if (!store.remove('banks', params.id)) throw Object.assign(new Error('题库不存在'), { status: 404 });
    store.removeWhere('questions', (q) => q.bankId === params.id);
    sendJson(res, 200, { ok: true });
  });

  /* ---------------------------- questions --------------------------- */
  on('GET', '/api/questions', ({ res, query }) => {
    let list = store.all('questions');
    if (query.bankId) list = list.filter((q) => q.bankId === query.bankId);
    if (query.difficulty) list = list.filter((q) => q.difficulty === query.difficulty);
    if (query.tag) list = list.filter((q) => (q.tags || []).includes(query.tag));
    if (query.q) {
      const needle = query.q.toLowerCase();
      list = list.filter(
        (q) =>
          String(q.content || '').toLowerCase().includes(needle) ||
          String(q.title || '').toLowerCase().includes(needle) ||
          (q.tags || []).some((t) => String(t).toLowerCase().includes(needle)),
      );
    }
    sendJson(res, 200, list);
  });

  on('POST', '/api/questions', ({ res, body }) => {
    if (!body?.content) throw Object.assign(new Error('缺少题干'), { status: 400 });
    if (!body.bankId) throw Object.assign(new Error('缺少题库'), { status: 400 });
    sendJson(res, 201, store.insert('questions', { type: 'open', tags: [], difficulty: 'medium', ...body }));
  });

  on('PUT', '/api/questions/:id', ({ res, params, body }) => {
    const record = store.update('questions', params.id, body || {});
    if (!record) throw Object.assign(new Error('题目不存在'), { status: 404 });
    sendJson(res, 200, record);
  });

  on('DELETE', '/api/questions/:id', ({ res, params }) => {
    if (!store.remove('questions', params.id)) throw Object.assign(new Error('题目不存在'), { status: 404 });
    sendJson(res, 200, { ok: true });
  });

  on('POST', '/api/questions/bulk-delete', ({ res, body }) => {
    const ids = new Set(body?.ids || []);
    const removed = store.removeWhere('questions', (q) => ids.has(q.id));
    sendJson(res, 200, { removed });
  });

  const QUESTION_HEADERS = [
    { key: 'title', label: '标题' },
    { key: 'content', label: '题干' },
    { key: 'tags', label: '标签' },
    { key: 'difficulty', label: '难度' },
    { key: 'answer', label: '参考答案' },
    { key: 'rubric', label: '评分要点' },
  ];

  on('GET', '/api/questions/export', ({ res, query }) => {
    const bank = query.bankId ? store.find('banks', query.bankId) : null;
    const list = store.all('questions').filter((q) => !query.bankId || q.bankId === query.bankId);
    const format = query.format || 'json';
    const stamp = new Date().toISOString().slice(0, 10);
    const safeName = (bank?.name || 'all-questions').replace(/[\\/:*?"<>|]/g, '_');
    if (format === 'csv') {
      const rows = list.map((q) => ({ ...q, tags: (q.tags || []).join('|') }));
      return sendText(res, 200, `\uFEFF${toCsv(rows, QUESTION_HEADERS)}`, 'text/csv; charset=utf-8', {
        'content-disposition': `attachment; filename="${encodeURIComponent(safeName)}-${stamp}.csv"`,
      });
    }
    if (format === 'md') {
      const md = list
        .map((q, i) => {
          const head = `### ${i + 1}. ${q.title || '未命名'}  \n`;
          const meta = `> 难度：${q.difficulty || '-'} ｜ 标签：${(q.tags || []).join('、') || '-'}\n\n`;
          const body = `${q.content}\n`;
          const rubric = q.rubric ? `\n**评分要点**：${q.rubric}\n` : '';
          return head + meta + body + rubric;
        })
        .join('\n---\n\n');
      return sendText(res, 200, `# ${bank?.name || '全部题目'}\n\n${md}`, 'text/markdown; charset=utf-8', {
        'content-disposition': `attachment; filename="${encodeURIComponent(safeName)}-${stamp}.md"`,
      });
    }
    return sendText(res, 200, JSON.stringify(list, null, 2), 'application/json; charset=utf-8', {
      'content-disposition': `attachment; filename="${encodeURIComponent(safeName)}-${stamp}.json"`,
    });
  });

  on('POST', '/api/questions/import', ({ res, body }) => {
    const bankId = body?.bankId;
    if (!bankId) throw Object.assign(new Error('缺少目标题库'), { status: 400 });
    if (!store.find('banks', bankId)) throw Object.assign(new Error('题库不存在'), { status: 404 });
    const raw = String(body.content || '');
    let items = [];
    if ((body.format || 'json') === 'csv') {
      const rows = parseCsv(raw);
      const header = rows.shift()?.map((h) => h.trim()) || [];
      const pick = (...names) => {
        for (const n of names) {
          const idx = header.findIndex((h) => h.toLowerCase() === n.toLowerCase());
          if (idx >= 0) return idx;
        }
        return -1;
      };
      const idx = {
        title: pick('标题', 'title'),
        content: pick('题干', 'content', 'question'),
        tags: pick('标签', 'tags'),
        difficulty: pick('难度', 'difficulty'),
        answer: pick('参考答案', 'answer'),
        rubric: pick('评分要点', 'rubric'),
      };
      items = rows.map((r) => ({
        title: idx.title >= 0 ? r[idx.title] : '',
        content: idx.content >= 0 ? r[idx.content] : r[0],
        tags: idx.tags >= 0 ? String(r[idx.tags] || '').split(/[|,，、]/).map((s) => s.trim()).filter(Boolean) : [],
        difficulty: (idx.difficulty >= 0 && ['easy', 'medium', 'hard'].includes(r[idx.difficulty])) ? r[idx.difficulty] : 'medium',
        answer: idx.answer >= 0 ? r[idx.answer] : '',
        rubric: idx.rubric >= 0 ? r[idx.rubric] : '',
      }));
    } else {
      const parsed = JSON.parse(raw);
      items = Array.isArray(parsed) ? parsed : parsed.questions || [];
    }
    const created = [];
    for (const item of items) {
      const content = String(item.content || item.question || item.题干 || '').trim();
      if (!content) continue;
      created.push(
        store.insert('questions', {
          bankId,
          title: item.title || item.标题 || '',
          content,
          tags: Array.isArray(item.tags) ? item.tags : String(item.tags || item.标签 || '').split(/[|,，、]/).map((s) => s.trim()).filter(Boolean),
          difficulty: ['easy', 'medium', 'hard'].includes(item.difficulty) ? item.difficulty : 'medium',
          answer: item.answer || item.参考答案 || '',
          rubric: item.rubric || item.评分要点 || '',
          type: item.type || 'open',
        }),
      );
    }
    sendJson(res, 200, { imported: created.length, questions: created });
  });

  /* ------------------------------- runs ----------------------------- */
  on('GET', '/api/runs', ({ res }) => {
    const list = store
      .all('runs')
      .map((r) => ({
        id: r.id,
        title: r.title,
        question: r.question,
        modelNames: (r.results || []).map((x) => x.modelName),
        status: r.status,
        createdAt: r.createdAt,
        avgLatency: r.results?.length
          ? Math.round((r.results.reduce((a, x) => a + (x.metrics?.latencyMs || 0), 0) / r.results.length))
          : 0,
        totalTokens: (r.results || []).reduce((a, x) => a + (x.metrics?.totalTokens || 0), 0),
        totalCost: (r.results || []).reduce((a, x) => a + (x.metrics?.cost || 0), 0),
      }))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    sendJson(res, 200, list);
  });

  on('POST', '/api/runs', ({ res, body }) => {
    const record = store.insert('runs', { title: '', status: 'done', results: [], ...body });
    sendJson(res, 201, record);
  });

  on('GET', '/api/runs/:id', ({ res, params }) => {
    const run = store.find('runs', params.id);
    if (!run) throw Object.assign(new Error('记录不存在'), { status: 404 });
    sendJson(res, 200, run);
  });

  on('PUT', '/api/runs/:id', ({ res, params, body }) => {
    const record = store.update('runs', params.id, body || {});
    if (!record) throw Object.assign(new Error('记录不存在'), { status: 404 });
    sendJson(res, 200, record);
  });

  on('DELETE', '/api/runs/:id', ({ res, params }) => {
    if (!store.remove('runs', params.id)) throw Object.assign(new Error('记录不存在'), { status: 404 });
    sendJson(res, 200, { ok: true });
  });

  /* ------------------------------- 裁判 ------------------------------ */
  on('POST', '/api/judge', async ({ req, res, body }) => {
    const judge = modelById(body.judgeModelId);
    if (!judge) throw Object.assign(new Error('未选择裁判模型'), { status: 400 });
    const candidates = body.candidates || [];
    const parts = candidates
      .map((c, i) => `【回答 ${i + 1}｜模型：${c.modelName}】\n${String(c.text || '').trim() || '（空）'}`)
      .join('\n\n');
    const prompt = [
      '你是一位严格、公正的模型评测裁判。请针对同一个问题，对多个模型的回答进行打分与对比。',
      '',
      `【问题】\n${body.question}`,
      body.rubric ? `\n【评分要点】\n${body.rubric}` : '',
      '',
      parts,
      '',
      '评分维度：正确性、完整性、指令遵循、表达质量。',
      '只输出一个 JSON 对象，不要输出任何其他文字或 Markdown 代码块，格式如下：',
      '{"ranking":[{"index":1,"score":8.5,"comment":"一句话点评"}],"summary":"总体结论","best":"回答 2"}',
      'score 为 0-10 的数字，index 与上面的回答编号一致（从 1 开始）。',
    ]
      .filter(Boolean)
      .join('\n');

    const sse = startSse(res);
    const controller = new AbortController();
    req.on('close', () => controller.abort());
    let text = '';
    try {
      sse.send({ type: 'start' });
      for await (const evt of streamChat(judge, [{ role: 'user', content: prompt }], { temperature: 0.2, maxTokens: 1600 }, controller.signal)) {
        if (evt.type === 'delta') {
          text += evt.text;
          sse.send({ type: 'delta', text: evt.text });
        }
      }
      let parsed = null;
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          parsed = null;
        }
      }
      sse.send({ type: 'result', raw: text, data: parsed, judgeModelId: judge.id, judgeModelName: judge.name });
    } catch (err) {
      sse.send({ type: 'error', message: err?.message || String(err) });
    } finally {
      sse.end();
    }
  });

  /* ------------------------------ stats ----------------------------- */
  on('GET', '/api/stats', ({ res }) => {
    const models = store.all('models');
    const questions = store.all('questions');
    const runs = store.all('runs');
    const conversations = store.all('conversations');
    const tokensByModel = {};
    let totalTokens = 0;
    let totalCost = 0;
    const timeline = [];
    for (const run of runs) {
      let runTokens = 0;
      for (const r of run.results || []) {
        const t = r.metrics?.totalTokens || 0;
        totalTokens += t;
        runTokens += t;
        totalCost += r.metrics?.cost || 0;
        const key = r.modelName || '未知';
        tokensByModel[key] = (tokensByModel[key] || 0) + t;
      }
      timeline.push({ at: run.createdAt, tokens: runTokens, models: (run.results || []).length });
    }
    timeline.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const byDifficulty = { easy: 0, medium: 0, hard: 0 };
    for (const q of questions) byDifficulty[q.difficulty || 'medium'] += 1;
    const tagCount = {};
    for (const q of questions) for (const t of q.tags || []) tagCount[t] = (tagCount[t] || 0) + 1;
    sendJson(res, 200, {
      counts: {
        models: models.length,
        enabledModels: models.filter((m) => m.enabled !== false).length,
        banks: store.all('banks').length,
        questions: questions.length,
        runs: runs.length,
        conversations: conversations.length,
        messages: conversations.reduce((a, c) => a + (c.messages?.length || 0), 0),
      },
      tokensByModel,
      totalTokens,
      totalCost,
      timeline: timeline.slice(-30),
      byDifficulty,
      topTags: Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 10),
      recentRuns: runs.slice(-5).reverse().map((r) => ({ id: r.id, title: r.title, question: r.question, createdAt: r.createdAt, modelCount: (r.results || []).length })),
    });
  });

  /* ------------------------------ 匹配器 ---------------------------- */
  function match(method, pathname) {
    for (const route of routes) {
      if (route.method !== method) continue;
      const rp = route.pattern.split('/');
      const ap = pathname.split('/');
      if (rp.length !== ap.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < rp.length; i += 1) {
        if (rp[i].startsWith(':')) params[rp[i].slice(1)] = decodeURIComponent(ap[i]);
        else if (rp[i] !== ap[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { route, params };
    }
    return null;
  }

  return async function handle(req, res, pathname, query) {
    const found = match(req.method, pathname);
    if (!found) {
      sendJson(res, 404, { error: `未知接口 ${req.method} ${pathname}` });
      return true;
    }
    try {
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      await found.route.handler({ req, res, params: found.params, query, body });
    } catch (err) {
      if (res.headersSent) {
        try {
          res.end();
        } catch {
          /* ignore */
        }
        return true;
      }
      const status = err?.status || 500;
      if (status >= 500) console.error('[api]', pathname, err);
      sendJson(res, status, { error: err?.message || '服务器内部错误' });
    }
    return true;
  };
}
