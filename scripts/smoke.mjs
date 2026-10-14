/**
 * 端到端冒烟测试：使用内置 mock 模型验证「接入 → 流式对话 → 多模型对比 → AI 裁判 → 记录/题库/导出」全链路。
 * 运行：node scripts/smoke.mjs    （需要先启动服务：node server/index.mjs）
 * 测试结束后会清理自己创建的数据。
 */
const BASE = process.env.BASE || 'http://127.0.0.1:8787';

let pass = 0;
let fail = 0;
const created = { models: [], runs: [], questions: [], banks: [], conversations: [] };

function ok(name, extra = '') {
  pass += 1;
  console.log(`  \u2713 ${name}${extra ? `  ${extra}` : ''}`);
}
function bad(name, err) {
  fail += 1;
  console.log(`  \u2717 ${name}  ->  ${err?.message || err}`);
}
async function check(name, fn) {
  try {
    const extra = await fn();
    ok(name, extra || '');
  } catch (err) {
    bad(name, err);
  }
}

async function json(path, init) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function stream(path, payload, onEvent) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let aggregated = { text: '', reasoning: '', metrics: null, error: '', events: 0 };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx = buf.indexOf('\n\n');
    while (idx >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw) continue;
        const evt = JSON.parse(raw);
        aggregated.events += 1;
        if (evt.type === 'delta') aggregated.text += evt.text;
        else if (evt.type === 'reasoning') aggregated.reasoning += evt.text;
        else if (evt.type === 'done') aggregated.metrics = evt.metrics;
        else if (evt.type === 'error') aggregated.error = evt.message;
        else if (evt.type === 'result') aggregated.result = evt;
        onEvent?.(evt);
      }
      idx = buf.indexOf('\n\n');
    }
  }
  return aggregated;
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

console.log(`\n冒烟测试 -> ${BASE}\n`);

/* 1. 基础健康检查 */
console.log('[1] 服务与页面');
await check('GET /api/health', async () => {
  const r = await json('/api/health');
  assert(r.ok, 'health.ok 应为 true');
});
await check('GET /api/bootstrap', async () => {
  const r = await json('/api/bootstrap');
  assert(r.counts, '缺少 counts');
  return `模型 ${r.counts.models} / 题库 ${r.counts.banks} / 题目 ${r.counts.questions}`;
});
await check('GET / 返回前端页面', async () => {
  const res = await fetch(BASE + '/');
  const html = await res.text();
  assert(res.ok, `HTTP ${res.status}`);
  assert(html.includes('<div id="root">'), '页面结构异常');
});
await check('GET /#/compare 走 SPA 回退', async () => {
  const res = await fetch(BASE + '/compare');
  assert(res.ok, `HTTP ${res.status}`);
});

/* 2. 模型接入 */
console.log('\n[2] 模型接入');
const mockModels = [
  { name: '冒烟测试·模拟A', model: 'mock-balanced', provider: 'mock', mockFlavor: 'balanced', pricing: { input: 1, output: 2 }, tags: ['smoke'] },
  { name: '冒烟测试·模拟B', model: 'mock-concise', provider: 'mock', mockFlavor: 'concise', pricing: { input: 1, output: 2 }, tags: ['smoke'] },
  { name: '冒烟测试·模拟C', model: 'mock-verbose', provider: 'mock', mockFlavor: 'verbose', tags: ['smoke'] },
];
for (const m of mockModels) {
  await check(`创建模型 ${m.name}`, async () => {
    const created1 = await json('/api/models', { method: 'POST', body: JSON.stringify(m) });
    created.models.push(created1.id);
    assert(created1.id, '未返回 id');
  });
}
await check('GET /api/models 不回传明文密钥', async () => {
  const list = await json('/api/models');
  assert(Array.isArray(list), '应为数组');
  assert(!list.some((m) => 'apiKey' in m), '响应中不应包含 apiKey 字段');
  return `共 ${list.length} 个`;
});
await check('POST /api/models/test-config 连通性测试', async () => {
  const r = await json('/api/models/test-config', {
    method: 'POST',
    body: JSON.stringify({ provider: 'mock', model: 'mock-balanced', name: 'probe' }),
  });
  assert(r.ok, '测试未通过');
  return `耗时 ${r.latencyMs}ms`;
});
await check('POST /api/models/probe 拉取模型列表', async () => {
  const r = await json('/api/models/probe', { method: 'POST', body: JSON.stringify({ provider: 'mock', model: '' }) });
  assert(r.models?.length >= 3, 'mock 应返回 3 个模型');
});

/* 3. 流式对话 */
console.log('\n[3] 流式对话');
let chatText = '';
await check('POST /api/chat/stream 流式返回', async () => {
  const r = await stream('/api/chat/stream', {
    modelId: created.models[0],
    messages: [{ role: 'user', content: '你好，请自我介绍。' }],
    systemPrompt: '你是测试助手。',
    params: { temperature: 0.5, maxTokens: 256 },
  });
  assert(!r.error, `流内错误: ${r.error}`);
  assert(r.text.length > 20, '返回内容过短');
  assert(r.metrics, '缺少 metrics');
  assert(r.metrics.ttftMs != null && r.metrics.ttftMs >= 0, '缺少首字延迟');
  assert(r.metrics.completionTokens > 0, '缺少 completionTokens');
  assert(r.metrics.cost > 0, '按单价应产生成本');
  chatText = r.text;
  return `${r.events} 个事件 / ${r.text.length} 字 / 首字 ${r.metrics.ttftMs}ms / 成本 $${r.metrics.cost.toFixed(5)}`;
});
await check('会话可创建并保存', async () => {
  const conv = await json('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ title: '冒烟会话', modelId: created.models[0], systemPrompt: '', messages: [] }),
  });
  created.conversations.push(conv.id);
  const updated = await json(`/api/conversations/${conv.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      messages: [
        { id: 'm1', role: 'user', content: '你好', createdAt: new Date().toISOString() },
        { id: 'm2', role: 'assistant', content: chatText, createdAt: new Date().toISOString() },
      ],
    }),
  });
  assert(updated.messages.length === 2, '消息未保存');
  const reread = await json(`/api/conversations/${conv.id}`);
  assert(reread.messages[1].content === chatText, '回读内容不一致');
});

/* 4. 题库 */
console.log('\n[4] 题库管理');
let bankId = '';
let questionId = '';
await check('创建题库', async () => {
  const bank = await json('/api/banks', { method: 'POST', body: JSON.stringify({ name: '冒烟题库', description: 'e2e' }) });
  bankId = bank.id;
  created.banks.push(bank.id);
});
await check('新增题目', async () => {
  const q = await json('/api/questions', {
    method: 'POST',
    body: JSON.stringify({ bankId, title: '冒烟题目', content: '请用一句话解释什么是 token。', tags: ['smoke', '概念'], difficulty: 'easy', rubric: '简洁准确' }),
  });
  questionId = q.id;
  created.questions.push(q.id);
});
await check('JSON 批量导入', async () => {
  const r = await json('/api/questions/import', {
    method: 'POST',
    body: JSON.stringify({
      bankId,
      format: 'json',
      content: JSON.stringify([
        { title: '导入1', content: '导入的题目一', tags: ['import'], difficulty: 'hard' },
        { title: '导入2', content: '导入的题目二', tags: 'import,概念', difficulty: 'medium' },
      ]),
    }),
  });
  assert(r.imported === 2, `期望导入 2 条，实际 ${r.imported}`);
  r.questions.forEach((q) => created.questions.push(q.id));
});
await check('CSV 批量导入（含中文表头）', async () => {
  const csv = '标题,题干,标签,难度,评分要点\nCSV题,来自CSV的题目,标签A|标签B,easy,要点X';
  const r = await json('/api/questions/import', { method: 'POST', body: JSON.stringify({ bankId, format: 'csv', content: csv }) });
  assert(r.imported === 1, `期望导入 1 条，实际 ${r.imported}`);
  r.questions.forEach((q) => created.questions.push(q.id));
  assert(r.questions[0].tags.length === 2, 'CSV 标签解析失败');
});
await check('按题库查询与筛选', async () => {
  const list = await json(`/api/questions?bankId=${bankId}`);
  assert(list.length >= 4, `期望 ≥4 条，实际 ${list.length}`);
  const hard = await json(`/api/questions?bankId=${bankId}&difficulty=hard`);
  assert(hard.length >= 1, '难度筛选失效');
  const search = await json(`/api/questions?bankId=${bankId}&q=${encodeURIComponent('CSV')}`);
  assert(search.length === 1, '搜索失效');
  return `共 ${list.length} 条`;
});
for (const fmt of ['json', 'csv', 'md']) {
  await check(`导出 ${fmt.toUpperCase()}`, async () => {
    const res = await fetch(`${BASE}/api/questions/export?bankId=${bankId}&format=${fmt}`);
    assert(res.ok, `HTTP ${res.status}`);
    const body = await res.text();
    assert(body.length > 10, '导出内容为空');
    assert(res.headers.get('content-disposition')?.includes('attachment'), '缺少下载头');
    return `${body.length} 字节`;
  });
}

/* 5. 多模型横向对比 */
console.log('\n[5] 多模型横向对比');
const runResults = [];
await check('三个模型并行流式返回', async () => {
  const question = '请用三点说明为什么需要多模型对比评测。';
  const settled = await Promise.all(
    created.models.map(async (id) => {
      const r = await stream('/api/run/stream', { modelId: id, question, systemPrompt: '', params: { temperature: 0.6, maxTokens: 400 } });
      assert(!r.error, `流内错误: ${r.error}`);
      assert(r.metrics?.latencyMs > 0, '缺少耗时');
      return r;
    }),
  );
  settled.forEach((r) => runResults.push(r));
  const names = settled.map((r) => `${r.text.length}字/${r.metrics.ttftMs}ms`).join('  ');
  return names;
});
await check('对比结果差异可观测（速度/长度不同）', async () => {
  const lens = runResults.map((r) => r.text.length);
  assert(new Set(lens).size > 1, '三个模型输出完全相同，对比无意义');
  const ttfts = runResults.map((r) => r.metrics.ttftMs);
  return `长度 ${lens.join('/')}，首字 ${ttfts.join('/')}ms`;
});

/* 6. AI 裁判 */
console.log('\n[6] AI 裁判');
await check('POST /api/judge 返回结构化评分', async () => {
  const r = await stream('/api/judge', {
    judgeModelId: created.models[0],
    question: '请用三点说明为什么需要多模型对比评测。',
    rubric: '三点清晰、无重复',
    candidates: runResults.map((x, i) => ({ modelName: `模型${i + 1}`, text: x.text })),
  });
  assert(!r.error, `裁判错误: ${r.error}`);
  assert(r.result, '未收到 result 事件');
  assert(r.result.data?.ranking?.length >= 2, '缺少 ranking');
  assert(r.result.raw.includes('{'), '缺少原始输出');
  return `评分 ${r.result.data.ranking.map((x) => x.score).join('/')}`;
});
await check('裁判 prompt 能容忍非 JSON 输出（不崩溃）', async () => {
  const r = await stream('/api/judge', { judgeModelId: created.models[0], question: 'q', candidates: [{ modelName: 'a', text: 'x' }, { modelName: 'b', text: 'y' }] });
  assert(r.result, '未收到 result');
});

/* 7. 评测记录 */
console.log('\n[7] 评测记录与统计');
let runId = '';
await check('保存评测记录', async () => {
  const run = await json('/api/runs', {
    method: 'POST',
    body: JSON.stringify({
      title: '冒烟对比',
      question: '请用三点说明为什么需要多模型对比评测。',
      questionId,
      rubric: '三点清晰',
      params: { temperature: 0.6 },
      status: 'done',
      results: created.models.map((id, i) => ({
        modelId: id,
        modelName: mockModels[i].name,
        provider: 'mock',
        text: runResults[i].text,
        metrics: runResults[i].metrics,
        status: 'ok',
        score: 4,
        note: '冒烟备注',
      })),
      judge: { judgeModelId: created.models[0], judgeModelName: mockModels[0].name, summary: 's', best: '回答 1', ranking: [{ index: 1, score: 8, comment: 'ok' }], at: new Date().toISOString() },
    }),
  });
  runId = run.id;
  created.runs.push(run.id);
});
await check('更新评测记录', async () => {
  const r = await json(`/api/runs/${runId}`, { method: 'PUT', body: JSON.stringify({ title: '冒烟对比（已更新）' }) });
  assert(r.title.includes('已更新'), '更新失败');
});
await check('列表与详情', async () => {
  const list = await json('/api/runs');
  assert(Array.isArray(list) && list.length >= 1, '列表为空');
  assert(typeof list[0].avgLatency === 'number', '缺少平均耗时');
  const detail = await json(`/api/runs/${runId}`);
  assert(detail.results.length === 3, '结果数量不对');
  assert(detail.judge.summary === 's', '裁判数据丢失');
});
await check('GET /api/stats 汇总', async () => {
  const s = await json('/api/stats');
  assert(s.counts.runs >= 1, 'runs 计数异常');
  assert(s.totalTokens > 0, 'totalTokens 应为正');
  assert(Object.keys(s.tokensByModel).length >= 1, '缺少按模型统计');
  return `tokens ${s.totalTokens} / 成本 $${s.totalCost.toFixed(5)}`;
});

/* 8. 错误处理 */
console.log('\n[8] 错误处理');
await check('不存在的模型返回 404', async () => {
  const res = await fetch(BASE + '/api/chat/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ modelId: 'nope', messages: [{ role: 'user', content: 'hi' }] }),
  });
  assert(res.status === 404, `期望 404，实际 ${res.status}`);
});
await check('空问题返回 400', async () => {
  const res = await fetch(BASE + '/api/run/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ modelId: created.models[0], question: '   ' }),
  });
  assert(res.status === 400, `期望 400，实际 ${res.status}`);
});
await check('未知接口返回 404 JSON', async () => {
  const res = await fetch(BASE + '/api/not-exist');
  assert(res.status === 404, `期望 404，实际 ${res.status}`);
  const body = await res.json();
  assert(body.error, '缺少 error 字段');
});
await check('上游错误能透传到流内', async () => {
  const bad = await json('/api/models', {
    method: 'POST',
    body: JSON.stringify({ name: '冒烟测试·坏地址', provider: 'openai', baseUrl: 'http://127.0.0.1:9/v1', model: 'x', apiKey: 'k' }),
  });
  created.models.push(bad.id);
  const r = await stream('/api/chat/stream', { modelId: bad.id, messages: [{ role: 'user', content: 'hi' }] });
  assert(r.error, '应返回流内错误');
  return r.error.slice(0, 48);
});

/* 9. 清理 */
console.log('\n[9] 清理测试数据');
await check('删除测试数据', async () => {
  for (const id of created.runs) await fetch(`${BASE}/api/runs/${id}`, { method: 'DELETE' });
  for (const id of created.conversations) await fetch(`${BASE}/api/conversations/${id}`, { method: 'DELETE' });
  for (const id of created.models) await fetch(`${BASE}/api/models/${id}`, { method: 'DELETE' });
  await fetch(`${BASE}/api/banks/${bankId}`, { method: 'DELETE' }); // 级联删除题目
  const [models, runs, questions] = await Promise.all([json('/api/models'), json('/api/runs'), json(`/api/questions?bankId=${bankId}`)]);
  assert(!models.some((m) => created.models.includes(m.id)), '模型未清理干净');
  assert(!runs.some((r) => created.runs.includes(r.id)), '记录未清理干净');
  assert(questions.length === 0, '题目未级联删除');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
