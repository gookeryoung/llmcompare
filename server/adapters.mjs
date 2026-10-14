/**
 * 上游模型适配层。
 * 统一把不同厂商的流式协议归一化成同一种事件序列：
 *   { type: 'delta', text }
 *   { type: 'reasoning', text }
 *   { type: 'usage', promptTokens, completionTokens }
 *   { type: 'finish', reason }
 */

/* ------------------------------- 工具函数 ------------------------------- */

export function normalizeBaseUrl(raw, provider) {
  let base = String(raw || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('未配置 Base URL');
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  if (provider === 'openai' || provider === 'ollama') {
    try {
      const u = new URL(base);
      // https://api.openai.com  -> https://api.openai.com/v1
      if ((u.pathname === '' || u.pathname === '/') && provider === 'openai') {
        u.pathname = '/v1';
        base = u.toString().replace(/\/+$/, '');
      }
    } catch {
      /* 交给 fetch 报错 */
    }
  }
  return base;
}

function joinUrl(base, suffix) {
  const b = String(base || '').replace(/\/+$/, '');
  if (b.endsWith(suffix)) return b;
  return b + suffix;
}

async function throwHttpError(res, label) {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 800);
  } catch {
    /* ignore */
  }
  let parsed;
  try {
    const j = JSON.parse(detail);
    parsed = j?.error?.message || j?.message || j?.error || '';
    if (typeof parsed !== 'string') parsed = JSON.stringify(parsed);
  } catch {
    parsed = detail;
  }
  const err = new Error(`${label} HTTP ${res.status}${parsed ? `: ${parsed}` : ''}`);
  err.status = res.status;
  err.body = detail;
  return err;
}

/** 把响应体按行切分（SSE / NDJSON 都适用） */
async function* readLines(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx = buf.indexOf('\n');
      while (idx >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        yield line;
        idx = buf.indexOf('\n');
      }
    }
    if (buf.trim()) yield buf.trim();
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

function parseData(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':') || trimmed.startsWith('event:')) return null;
  const idx = trimmed.indexOf('data:');
  const payload = idx === 0 ? trimmed.slice(5).trim() : trimmed;
  if (!payload || payload === '[DONE]') return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/** 发送请求，遇到 400/422 时自动去掉可选参数重试一次（兼容不支持 stream_options 的网关） */
async function postJson(url, { headers, body, signal, degradeKeys = [] }) {
  const doFetch = (payload) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream, application/json', ...headers },
      body: JSON.stringify(payload),
      signal,
    });
  let res = await doFetch(body);
  if (!res.ok && (res.status === 400 || res.status === 422) && degradeKeys.length) {
    const soft = { ...body };
    let changed = false;
    for (const k of degradeKeys) {
      if (k in soft) {
        delete soft[k];
        changed = true;
      }
    }
    if (changed) {
      try {
        await res.text();
      } catch {
        /* ignore */
      }
      res = await doFetch(soft);
    }
  }
  return res;
}

/* --------------------------- OpenAI 兼容协议 --------------------------- */

async function* streamOpenAI(cfg, messages, opts, signal) {
  const base = normalizeBaseUrl(cfg.baseUrl, 'openai');
  const url = joinUrl(base, '/chat/completions');
  const headers = { ...(cfg.extraHeaders || {}) };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  const body = {
    model: cfg.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
    ...(opts.topP != null ? { top_p: opts.topP } : {}),
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
  };
  const res = await postJson(url, { headers, body, signal, degradeKeys: ['stream_options'] });
  if (!res.ok) throw await throwHttpError(res, `上游(${cfg.name || cfg.model})`);

  const ctype = res.headers.get('content-type') || '';
  if (!/event-stream|stream/i.test(ctype) || !res.body) {
    // 少数网关忽略 stream=true，直接返回整包 JSON
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content ?? '';
    if (text) yield { type: 'delta', text };
    if (json?.usage) {
      yield {
        type: 'usage',
        promptTokens: json.usage.prompt_tokens ?? 0,
        completionTokens: json.usage.completion_tokens ?? 0,
      };
    }
    yield { type: 'finish', reason: json?.choices?.[0]?.finish_reason || 'stop' };
    return;
  }

  let finish = '';
  for await (const line of readLines(res.body)) {
    const data = parseData(line);
    if (!data) continue;
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    const choice = data.choices?.[0];
    const delta = choice?.delta || {};
    if (typeof delta.content === 'string' && delta.content) yield { type: 'delta', text: delta.content };
    const reasoning = delta.reasoning_content || delta.reasoning;
    if (typeof reasoning === 'string' && reasoning) yield { type: 'reasoning', text: reasoning };
    if (choice?.finish_reason) finish = choice.finish_reason;
    if (data.usage) {
      yield {
        type: 'usage',
        promptTokens: data.usage.prompt_tokens ?? 0,
        completionTokens: data.usage.completion_tokens ?? 0,
      };
    }
  }
  yield { type: 'finish', reason: finish || 'stop' };
}

/* ----------------------------- Anthropic ------------------------------ */

async function* streamAnthropic(cfg, messages, opts, signal) {
  const base = normalizeBaseUrl(cfg.baseUrl, 'anthropic');
  const url = joinUrl(base, '/v1/messages');
  const headers = { 'anthropic-version': cfg.anthropicVersion || '2023-06-01', ...(cfg.extraHeaders || {}) };
  const authStyle = cfg.authStyle || 'x-api-key';
  if (cfg.apiKey) {
    if (authStyle === 'bearer' || authStyle === 'both') headers.authorization = `Bearer ${cfg.apiKey}`;
    if (authStyle === 'x-api-key' || authStyle === 'both') headers['x-api-key'] = cfg.apiKey;
  }
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }));
  const body = {
    model: cfg.model,
    messages: turns,
    max_tokens: opts.maxTokens || 2048,
    stream: true,
    ...(system ? { system } : {}),
    ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
    ...(opts.topP != null ? { top_p: opts.topP } : {}),
  };
  const res = await postJson(url, { headers, body, signal });
  if (!res.ok) throw await throwHttpError(res, `上游(${cfg.name || cfg.model})`);

  let finish = '';
  for await (const line of readLines(res.body)) {
    const data = parseData(line);
    if (!data) continue;
    const type = data.type;
    if (type === 'error') throw new Error(data.error?.message || JSON.stringify(data.error));
    if (type === 'content_block_delta') {
      const d = data.delta || {};
      if (d.type === 'text_delta' && d.text) yield { type: 'delta', text: d.text };
      else if (d.type === 'thinking_delta' && d.thinking) yield { type: 'reasoning', text: d.thinking };
    } else if (type === 'message_start' && data.message?.usage) {
      yield { type: 'usage', promptTokens: data.message.usage.input_tokens ?? 0, completionTokens: 0 };
    } else if (type === 'message_delta') {
      if (data.delta?.stop_reason) finish = data.delta.stop_reason;
      if (data.usage) {
        yield { type: 'usage', promptTokens: 0, completionTokens: data.usage.output_tokens ?? 0 };
      }
    }
  }
  yield { type: 'finish', reason: finish || 'stop' };
}

/* ------------------------------- Gemini ------------------------------- */

async function* streamGemini(cfg, messages, opts, signal) {
  const base = normalizeBaseUrl(cfg.baseUrl, 'gemini');
  const model = encodeURIComponent(cfg.model.replace(/^models\//, ''));
  const url = `${base}/v1beta/models/${model}:streamGenerateContent?alt=sse`;
  const headers = { 'x-goog-api-key': cfg.apiKey || '', ...(cfg.extraHeaders || {}) };
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const contents = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const body = {
    contents,
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig: {
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      ...(opts.topP != null ? { topP: opts.topP } : {}),
      ...(opts.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}),
    },
  };
  const res = await postJson(url, { headers, body, signal });
  if (!res.ok) throw await throwHttpError(res, `上游(${cfg.name || cfg.model})`);

  let finish = '';
  for await (const line of readLines(res.body)) {
    const data = parseData(line);
    if (!data) continue;
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    const cand = data.candidates?.[0];
    for (const part of cand?.content?.parts || []) {
      if (typeof part.text === 'string' && part.text) yield { type: 'delta', text: part.text };
    }
    if (cand?.finishReason) finish = String(cand.finishReason).toLowerCase();
    if (data.usageMetadata) {
      yield {
        type: 'usage',
        promptTokens: data.usageMetadata.promptTokenCount ?? 0,
        completionTokens: data.usageMetadata.candidatesTokenCount ?? 0,
      };
    }
  }
  yield { type: 'finish', reason: finish || 'stop' };
}

/* ------------------------------- Ollama ------------------------------- */

async function* streamOllama(cfg, messages, opts, signal) {
  const base = normalizeBaseUrl(cfg.baseUrl, 'ollama');
  if (/\/v1$/.test(base)) {
    // 用户填的是 Ollama 的 OpenAI 兼容入口
    yield* streamOpenAI({ ...cfg, baseUrl: base }, messages, opts, signal);
    return;
  }
  const url = joinUrl(base, '/api/chat');
  const headers = { ...(cfg.extraHeaders || {}) };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  const body = {
    model: cfg.model,
    messages,
    stream: true,
    options: {
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      ...(opts.topP != null ? { top_p: opts.topP } : {}),
      ...(opts.maxTokens ? { num_predict: opts.maxTokens } : {}),
    },
  };
  const res = await postJson(url, { headers, body, signal });
  if (!res.ok) throw await throwHttpError(res, `上游(${cfg.name || cfg.model})`);

  let finish = '';
  for await (const line of readLines(res.body)) {
    if (!line.trim()) continue;
    let data;
    try {
      data = JSON.parse(line);
    } catch {
      continue;
    }
    if (data.error) throw new Error(data.error);
    if (data.message?.content) yield { type: 'delta', text: data.message.content };
    if (data.done) {
      finish = data.done_reason || 'stop';
      yield {
        type: 'usage',
        promptTokens: data.prompt_eval_count ?? 0,
        completionTokens: data.eval_count ?? 0,
      };
    }
  }
  yield { type: 'finish', reason: finish || 'stop' };
}

/* ------------------------- 内置 Mock（无需密钥） ------------------------ */

async function* streamMock(cfg, messages, opts, signal) {
  const question = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const flavor = cfg.mockFlavor || 'balanced';

  // 被当作「AI 裁判」调用时，返回结构化评分，保证无密钥也能完整演示评测闭环
  if (/"ranking"/.test(question) && question.includes('【回答')) {
    const candidates = [...question.matchAll(/【回答 (\d+)｜模型：(.+?)】/g)].map((m) => ({ index: Number(m[1]), name: m[2] }));
    const list = candidates.length ? candidates : [{ index: 1, name: '回答 1' }, { index: 2, name: '回答 2' }];
    const ranking = list.map((c, i) => ({
      index: c.index,
      score: Number((9.2 - i * 0.7 - (flavor === 'verbose' ? 0.3 : 0)).toFixed(1)),
      comment: `（模拟裁判）第 ${c.index} 个回答结构完整、要点清晰，${i === 0 ? '在准确性与表达上略胜一筹' : '在细节与深度上还有提升空间'}。`,
    }));
    const best = list[0]?.index || 1;
    const payload = JSON.stringify(
      { ranking, summary: `（模拟裁判）整体质量都不错，回答 ${best} 在正确性与指令遵循上表现最好；建议结合人工评分共同判断。`, best: `回答 ${best}` },
      null,
      0,
    );
    const chunks = [];
    for (let i = 0; i < payload.length; i += 8) chunks.push(payload.slice(i, i + 8));
    for (const chunk of chunks) {
      if (signal?.aborted) throw new Error('已中止');
      await new Promise((r) => setTimeout(r, 6));
      yield { type: 'delta', text: chunk };
    }
    yield { type: 'usage', promptTokens: Math.max(1, Math.round(question.length / 4)), completionTokens: Math.max(1, Math.round(payload.length / 3)) };
    yield { type: 'finish', reason: 'stop' };
    return;
  }

  const prefix =
    flavor === 'concise'
      ? '【简洁模式】'
      : flavor === 'verbose'
        ? '【详尽模式】以下为分点展开的完整分析。'
        : '【均衡模式】';
  const body = [
    `${prefix}我是内置模拟模型「${cfg.name || cfg.model}」，用于在没有真实 API Key 的情况下体验完整流程。`,
    '',
    `我收到的内容是：${question.slice(0, 120)}${question.length > 120 ? '…' : ''}`,
    '',
    '这是一段用于验证流式渲染、延迟统计与横向对比排版的模拟回答。它会在若干秒内逐字输出，',
    '因此你可以观察到首字延迟（TTFT）、总耗时、字符/秒等指标的实时变化。',
    '',
    '要接入真实模型，请到「模型接入」页面新增一个配置并填入 Base URL 与 API Key。',
  ].join('\n');

  const delay = flavor === 'verbose' ? 12 : flavor === 'concise' ? 4 : 8;
  const sliceSize = flavor === 'concise' ? 6 : 3;
  let emitted = 0;
  for (let i = 0; i < body.length; i += sliceSize) {
    if (signal?.aborted) throw new Error('已中止');
    await new Promise((r) => setTimeout(r, delay));
    const chunk = body.slice(i, i + sliceSize);
    emitted += chunk.length;
    yield { type: 'delta', text: chunk };
  }
  yield { type: 'usage', promptTokens: Math.max(1, Math.round(question.length / 4)), completionTokens: Math.max(1, Math.round(emitted / 3)) };
  yield { type: 'finish', reason: 'stop' };
}

/* ------------------------------ 对外 API ------------------------------ */

const ADAPTERS = {
  openai: streamOpenAI,
  anthropic: streamAnthropic,
  gemini: streamGemini,
  ollama: streamOllama,
  mock: streamMock,
};

export function resolveAdapter(provider) {
  return ADAPTERS[provider] || streamOpenAI;
}

/**
 * 归一化流式调用。
 * @param {object} cfg 模型配置（provider/baseUrl/apiKey/model/...）
 * @param {Array<{role:string,content:string}>} messages
 * @param {{temperature?:number, topP?:number, maxTokens?:number}} opts
 * @param {AbortSignal} signal
 */
export function streamChat(cfg, messages, opts = {}, signal) {
  if (!cfg) throw new Error('模型未找到');
  if (!cfg.model) throw new Error('未配置模型 ID');
  return resolveAdapter(cfg.provider)(cfg, messages, opts, signal);
}

/** 拉取上游可用模型列表（OpenAI 兼容 / Ollama） */
export async function listUpstreamModels(cfg, signal) {
  if (cfg.provider === 'mock') {
    return ['mock-balanced', 'mock-concise', 'mock-verbose'];
  }
  if (cfg.provider === 'gemini') {
    const base = normalizeBaseUrl(cfg.baseUrl, 'gemini');
    const res = await fetch(`${base}/v1beta/models`, { headers: { 'x-goog-api-key': cfg.apiKey || '' }, signal });
    if (!res.ok) throw await throwHttpError(res, 'Gemini');
    const json = await res.json();
    return (json.models || []).map((m) => String(m.name || '').replace(/^models\//, '')).filter(Boolean);
  }
  if (cfg.provider === 'anthropic') {
    const base = normalizeBaseUrl(cfg.baseUrl, 'anthropic');
    const headers = { 'anthropic-version': cfg.anthropicVersion || '2023-06-01' };
    if (cfg.apiKey) {
      headers['x-api-key'] = cfg.apiKey;
      headers.authorization = `Bearer ${cfg.apiKey}`;
    }
    const res = await fetch(`${base}/v1/models`, { headers, signal });
    if (!res.ok) throw await throwHttpError(res, 'Anthropic');
    const json = await res.json();
    return (json.data || []).map((m) => m.id).filter(Boolean);
  }
  if (cfg.provider === 'ollama' && !/\/v1$/.test(String(cfg.baseUrl || ''))) {
    const base = normalizeBaseUrl(cfg.baseUrl, 'ollama');
    const headers = cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {};
    const res = await fetch(`${base}/api/tags`, { headers, signal });
    if (!res.ok) throw await throwHttpError(res, 'Ollama');
    const json = await res.json();
    return (json.models || []).map((m) => m.name).filter(Boolean);
  }
  const base = normalizeBaseUrl(cfg.baseUrl, 'openai');
  const headers = cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {};
  const res = await fetch(joinUrl(base, '/models'), { headers, signal });
  if (!res.ok) throw await throwHttpError(res, '上游');
  const json = await res.json();
  const list = Array.isArray(json) ? json : json.data || json.models || [];
  return list.map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
}

/** 连接测试：发一条极短请求，返回耗时与首字延迟 */
export async function testConnection(cfg, signal, timeoutMs = 30000) {
  const started = Date.now();
  let ttft = null;
  let text = '';
  const timer = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timer]) : timer;
  for await (const evt of streamChat(cfg, [{ role: 'user', content: '你好，请只回复两个字：收到' }], { maxTokens: 24, temperature: 0 }, combined)) {
    if (evt.type === 'delta') {
      if (ttft == null) ttft = Date.now() - started;
      text += evt.text;
    }
  }
  return { ok: true, latencyMs: Date.now() - started, ttftMs: ttft, sample: text.slice(0, 120) };
}
