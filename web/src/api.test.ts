import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, streamRequest, type StreamHandlers } from './api';

/** 构造一个最小 Response 替身 */
function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

describe('api 请求封装', () => {
  it('GET 成功时解析 JSON', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 'm1' }]));
    await expect(api.listModels()).resolves.toEqual([{ id: 'm1' }]);
    expect(fetchMock).toHaveBeenCalledWith('/api/models', { headers: { 'content-type': 'application/json' } });
  });

  it('POST 序列化请求体', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'b1', name: '题库' }));
    const created = await api.createBank({ name: '题库' });
    expect(created).toEqual({ id: 'b1', name: '题库' });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: '题库' });
  });

  it('DELETE 走正确方法', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await expect(api.deleteModel('m1')).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });

  it('非 2xx 抛出后端 error 字段', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: '模型不存在' }, 404));
    await expect(api.getRun('r1')).rejects.toThrow('模型不存在');
  });

  it('非 2xx 且无 error 字段时退回状态码', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error', json: async () => { throw new Error('not json'); } } as unknown as Response);
    await expect(api.listBanks()).rejects.toThrow('500 Internal Server Error');
  });

  it('URL 参数编码进查询串', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await api.listQuestions({ bankId: 'b 1', difficulty: 'hard' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/questions?bankId=b+1&difficulty=hard');
  });

  it('exportUrl 拼接下载地址', () => {
    expect(api.exportUrl('b/1', 'csv')).toBe('/api/questions/export?bankId=b%2F1&format=csv');
  });

  it('204 / 空响应返回 undefined 而不抛解析错误', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' } as unknown as Response);
    await expect(api.stats()).resolves.toBeUndefined();
  });

  it('全部端点路径与方法映射正确', async () => {
    // [调用, 期望 method, 期望 path]
    const cases: Array<[() => Promise<unknown>, string, string]> = [
      [() => api.bootstrap(), 'GET', '/api/bootstrap'],
      [() => api.stats(), 'GET', '/api/stats'],
      [() => api.getSettings(), 'GET', '/api/settings'],
      [() => api.saveSettings({ theme: 'dark' }), 'PUT', '/api/settings'],
      [() => api.listModels(), 'GET', '/api/models'],
      [() => api.createModel({ name: 'x' }), 'POST', '/api/models'],
      [() => api.updateModel('m1', { name: 'y' }), 'PUT', '/api/models/m1'],
      [() => api.deleteModel('m1'), 'DELETE', '/api/models/m1'],
      [() => api.testModel('m1'), 'POST', '/api/models/m1/test'],
      [() => api.testConfig({ name: 'x' }), 'POST', '/api/models/test-config'],
      [() => api.probeModels({ name: 'x' }), 'POST', '/api/models/probe'],
      [() => api.listConversations(), 'GET', '/api/conversations'],
      [() => api.createConversation({}), 'POST', '/api/conversations'],
      [() => api.getConversation('c1'), 'GET', '/api/conversations/c1'],
      [() => api.saveConversation('c1', {}), 'PUT', '/api/conversations/c1'],
      [() => api.deleteConversation('c1'), 'DELETE', '/api/conversations/c1'],
      [() => api.listBanks(), 'GET', '/api/banks'],
      [() => api.createBank({}), 'POST', '/api/banks'],
      [() => api.updateBank('b1', {}), 'PUT', '/api/banks/b1'],
      [() => api.deleteBank('b1'), 'DELETE', '/api/banks/b1'],
      [() => api.createQuestion({}), 'POST', '/api/questions'],
      [() => api.updateQuestion('q1', {}), 'PUT', '/api/questions/q1'],
      [() => api.deleteQuestion('q1'), 'DELETE', '/api/questions/q1'],
      [() => api.bulkDeleteQuestions(['q1']), 'POST', '/api/questions/bulk-delete'],
      [() => api.importQuestions('b1', 'a,b', 'csv'), 'POST', '/api/questions/import'],
      [() => api.listRuns(), 'GET', '/api/runs'],
      [() => api.getRun('r1'), 'GET', '/api/runs/r1'],
      [() => api.saveRun({}), 'POST', '/api/runs'],
      [() => api.updateRun('r1', {}), 'PUT', '/api/runs/r1'],
      [() => api.deleteRun('r1'), 'DELETE', '/api/runs/r1'],
    ];
    for (const [call, method, path] of cases) {
      fetchMock.mockResolvedValueOnce(jsonResponse({}));
      await call();
      const [calledPath, init] = fetchMock.mock.calls.at(-1)!;
      expect(calledPath).toBe(path);
      expect(init.method ?? 'GET').toBe(method);
    }
  });
});

/** 把事件数组编成 SSE 字节流 */
function sseResponse(events: Array<{ type: string; [k: string]: unknown }>, opts: { status?: number; chunks?: number } = {}) {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  const encoder = new TextEncoder();
  const chunkSize = opts.chunks ?? 2; // 拆成多个 chunk，验证跨块缓冲
  const parts: Uint8Array[] = [];
  const bytes = encoder.encode(body);
  for (let i = 0; i < bytes.length; i += chunkSize) parts.push(bytes.slice(i, i + chunkSize));
  let i = 0;
  return {
    ok: (opts.status ?? 200) === 200,
    status: opts.status ?? 200,
    statusText: 'OK',
    json: async () => ({}),
    body: { getReader: () => ({ read: async () => (i < parts.length ? { done: false, value: parts[i++] } : { done: true, value: undefined }) }) },
  } as unknown as Response;
}

describe('streamRequest SSE 解析', () => {
  it('按事件类型分发给对应 handler（含跨 chunk 缓冲）', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        { type: 'start', model: 'a' },
        { type: 'delta', text: '你好' },
        { type: 'delta', text: '世界' },
        { type: 'reasoning', text: '思考' },
        { type: 'done', metrics: { latencyMs: 12 } },
      ]),
    );
    const seen: string[] = [];
    const handlers: StreamHandlers = {
      onStart: () => seen.push('start'),
      onDelta: (t) => seen.push(`delta:${t}`),
      onReasoning: (t) => seen.push(`reasoning:${t}`),
      onDone: () => seen.push('done'),
    };
    await streamRequest('/api/chat', {}, handlers);
    expect(seen).toEqual(['start', 'delta:你好', 'delta:世界', 'reasoning:思考', 'done']);
  });

  it('onEvent 收到全部事件，坏 JSON 行被跳过', async () => {
    const body = ['data: {bad json', 'data: {"type":"delta","text":"ok"}', 'data: ', ''].join('\n\n');
    const encoder = new TextEncoder();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: {
        getReader: () => {
          let done = false;
          return { read: async () => (done ? { done: true, value: undefined } : ((done = true), { done: false, value: encoder.encode(body) })) };
        },
      },
    } as unknown as Response);
    const events: string[] = [];
    await streamRequest('/api/chat', {}, { onEvent: (e) => events.push(e.type), onDelta: (t) => events.push(t) });
    expect(events).toEqual(['delta', 'ok']);
  });

  it('非 2xx 调用 onError 并携带后端错误信息', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: '上游不可用' }, 502));
    const errors: string[] = [];
    await streamRequest('/api/chat', {}, { onError: (m) => errors.push(m) });
    expect(errors).toEqual(['上游不可用']);
  });

  it('流内 error 事件转发给 onError', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([{ type: 'error', message: '模型超时' }]));
    const errors: string[] = [];
    await streamRequest('/api/chat', {}, { onError: (m) => errors.push(m) });
    expect(errors).toEqual(['模型超时']);
  });

  it('AbortError 不触发 onError', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            throw err;
          },
        }),
      },
    } as unknown as Response);
    const errors: string[] = [];
    await streamRequest('/api/chat', {}, { onError: (m) => errors.push(m) });
    expect(errors).toEqual([]);
  });
});
