import type {
  Bank,
  Conversation,
  ConversationSummary,
  ModelConfig,
  Question,
  Run,
  RunSummary,
  Settings,
  Stats,
} from './types';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

const post = <T>(path: string, body: unknown) => req<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
const put = <T>(path: string, body: unknown) => req<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) });
const del = <T>(path: string) => req<T>(path, { method: 'DELETE' });

/* ------------------------------ 流式事件 ------------------------------ */

export interface StreamEvent {
  type: string;
  text?: string;
  message?: string;
  metrics?: any;
  [k: string]: any;
}

export interface StreamHandlers {
  onStart?: (e: StreamEvent) => void;
  onDelta?: (text: string) => void;
  onReasoning?: (text: string) => void;
  onDone?: (e: StreamEvent) => void;
  onError?: (message: string) => void;
  onEvent?: (e: StreamEvent) => void;
}

/** 用 POST + fetch 读取服务端 SSE 流（支持中途 abort） */
export async function streamRequest(path: string, payload: unknown, handlers: StreamHandlers, signal?: AbortSignal) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok || !res.body) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* ignore */
    }
    handlers.onError?.(message);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  try {
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
          let evt: StreamEvent;
          try {
            evt = JSON.parse(raw);
          } catch {
            continue;
          }
          handlers.onEvent?.(evt);
          if (evt.type === 'start') handlers.onStart?.(evt);
          else if (evt.type === 'delta') handlers.onDelta?.(evt.text || '');
          else if (evt.type === 'reasoning') handlers.onReasoning?.(evt.text || '');
          else if (evt.type === 'done') handlers.onDone?.(evt);
          else if (evt.type === 'error') handlers.onError?.(evt.message || '未知错误');
        }
        idx = buf.indexOf('\n\n');
      }
    }
  } catch (err: any) {
    if (err?.name !== 'AbortError') handlers.onError?.(err?.message || String(err));
  }
}

/* -------------------------------- API -------------------------------- */

export const api = {
  bootstrap: () => req<{ settings: Settings; counts: Stats['counts'] }>('/api/bootstrap'),
  stats: () => req<Stats>('/api/stats'),
  getSettings: () => req<Settings>('/api/settings'),
  saveSettings: (patch: Partial<Settings>) => put<Settings>('/api/settings', patch),

  listModels: () => req<ModelConfig[]>('/api/models'),
  createModel: (body: Partial<ModelConfig>) => post<ModelConfig>('/api/models', body),
  updateModel: (id: string, body: Partial<ModelConfig>) => put<ModelConfig>(`/api/models/${id}`, body),
  deleteModel: (id: string) => del<{ ok: true }>(`/api/models/${id}`),
  testModel: (id: string) => post<{ latencyMs: number; ttftMs: number | null; sample: string }>(`/api/models/${id}/test`, {}),
  testConfig: (body: Partial<ModelConfig>) =>
    post<{ latencyMs: number; ttftMs: number | null; sample: string }>('/api/models/test-config', body),
  probeModels: (body: Partial<ModelConfig>) => post<{ models: string[] }>('/api/models/probe', body),

  listConversations: () => req<ConversationSummary[]>('/api/conversations'),
  createConversation: (body: Partial<Conversation>) => post<Conversation>('/api/conversations', body),
  getConversation: (id: string) => req<Conversation>(`/api/conversations/${id}`),
  saveConversation: (id: string, body: Partial<Conversation>) => put<Conversation>(`/api/conversations/${id}`, body),
  deleteConversation: (id: string) => del<{ ok: true }>(`/api/conversations/${id}`),

  listBanks: () => req<Bank[]>('/api/banks'),
  createBank: (body: Partial<Bank>) => post<Bank>('/api/banks', body),
  updateBank: (id: string, body: Partial<Bank>) => put<Bank>(`/api/banks/${id}`, body),
  deleteBank: (id: string) => del<{ ok: true }>(`/api/banks/${id}`),

  listQuestions: (params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return req<Question[]>(`/api/questions${qs ? `?${qs}` : ''}`);
  },
  createQuestion: (body: Partial<Question>) => post<Question>('/api/questions', body),
  updateQuestion: (id: string, body: Partial<Question>) => put<Question>(`/api/questions/${id}`, body),
  deleteQuestion: (id: string) => del<{ ok: true }>(`/api/questions/${id}`),
  bulkDeleteQuestions: (ids: string[]) => post<{ removed: number }>('/api/questions/bulk-delete', { ids }),
  importQuestions: (bankId: string, content: string, format: 'json' | 'csv') =>
    post<{ imported: number }>('/api/questions/import', { bankId, content, format }),
  exportUrl: (bankId: string, format: 'json' | 'csv' | 'md') =>
    `/api/questions/export?bankId=${encodeURIComponent(bankId)}&format=${format}`,

  listRuns: () => req<RunSummary[]>('/api/runs'),
  getRun: (id: string) => req<Run>(`/api/runs/${id}`),
  saveRun: (body: Partial<Run>) => post<Run>('/api/runs', body),
  updateRun: (id: string, body: Partial<Run>) => put<Run>(`/api/runs/${id}`, body),
  deleteRun: (id: string) => del<{ ok: true }>(`/api/runs/${id}`),
};
