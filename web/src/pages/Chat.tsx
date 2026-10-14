import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, streamRequest } from '../api';
import { useApp } from '../state';
import type { ChatMessage, Conversation, ConversationSummary, Metrics, ModelConfig } from '../types';
import { PROVIDER_BADGE, PROVIDER_LABEL, formatCost, formatMs, formatTokens, timeAgo, uid } from '../lib/format';
import { AutoTextarea, Badge, Button, CopyButton, Empty, Field, Spinner, useConfirm } from '../components/ui';
import { Markdown } from '../components/Markdown';
import {
  IconChat,
  IconPlus,
  IconSearch,
  IconSend,
  IconStop,
  IconTrash,
  IconRefresh,
  IconSliders,
  IconAlert,
  IconClock,
  IconCoin,
  IconGauge,
} from '../components/Icons';

const EMPTY_METRICS: Metrics = {
  latencyMs: 0,
  ttftMs: null,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  chars: 0,
  charsPerSec: 0,
  cost: 0,
  finishReason: '',
};

function toApiMessages(messages: ChatMessage[], extraUser?: string) {
  const out = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content }));
  if (extraUser) out.push({ role: 'user', content: extraUser });
  return out;
}

export default function ChatPage() {
  const { enabledModels, modelById, pushToast, navigate } = useApp();
  const confirm = useConfirm();
  const [list, setList] = useState<ConversationSummary[]>([]);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [query, setQuery] = useState('');
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const loadList = useCallback(async () => {
    try {
      setList(await api.listConversations());
    } catch (err: any) {
      pushToast('err', err.message);
    }
  }, [pushToast]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const openConversation = useCallback(
    async (id: string) => {
      setLoading(true);
      try {
        setConv(await api.getConversation(id));
      } catch (err: any) {
        pushToast('err', err.message);
      } finally {
        setLoading(false);
      }
    },
    [pushToast],
  );

  const createConversation = useCallback(async () => {
    const model = enabledModels[0];
    if (!model) {
      pushToast('err', '请先在「模型接入」中添加并启用至少一个模型');
      navigate('models');
      return;
    }
    try {
      const created = await api.createConversation({
        title: '新对话',
        modelId: model.id,
        systemPrompt: '',
        messages: [],
        params: { temperature: model.temperature ?? 0.7, topP: model.topP ?? 1, maxTokens: model.maxTokens ?? 2048 },
      });
      setConv(created);
      setList((prev) => [
        { id: created.id, title: created.title, modelId: created.modelId, messageCount: 0, preview: '', createdAt: created.createdAt, updatedAt: created.updatedAt },
        ...prev,
      ]);
    } catch (err: any) {
      pushToast('err', err.message);
    }
  }, [enabledModels, navigate, pushToast]);

  const persist = useCallback(
    async (next: Conversation) => {
      try {
        await api.saveConversation(next.id, {
          title: next.title,
          modelId: next.modelId,
          systemPrompt: next.systemPrompt,
          params: next.params,
          messages: next.messages,
        });
        setList((prev) =>
          prev.map((c) =>
            c.id === next.id
              ? {
                  ...c,
                  title: next.title,
                  modelId: next.modelId,
                  messageCount: next.messages.length,
                  preview: next.messages.filter((m) => m.role === 'user').slice(-1)[0]?.content?.slice(0, 80) || '',
                  updatedAt: new Date().toISOString(),
                }
              : c,
          ),
        );
      } catch (err: any) {
        pushToast('err', `保存失败：${err.message}`);
      }
    },
    [pushToast],
  );

  const scrollToBottom = useCallback((force = false) => {
    const el = scrollRef.current;
    if (!el) return;
    if (force || stickRef.current) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom(true);
  }, [conv?.id, scrollToBottom]);

  const runStream = useCallback(
    async (base: Conversation, history: ChatMessage[], assistantId: string) => {
      const model = modelById(base.modelId) || enabledModels[0];
      if (!model) {
        pushToast('err', '当前会话的模型不可用，请重新选择');
        return;
      }
      setStreaming(true);
      stickRef.current = true;
      const controller = new AbortController();
      abortRef.current = controller;
      let acc = '';
      let reasoning = '';
      let raf = 0;
      let finalMetrics: Metrics | null = null;
      let failure = '';

      const flush = () => {
        raf = 0;
        setConv((cur) =>
          cur
            ? { ...cur, messages: cur.messages.map((m) => (m.id === assistantId ? { ...m, content: acc, reasoning } : m)) }
            : cur,
        );
        scrollToBottom();
      };
      const schedule = () => {
        if (!raf) raf = requestAnimationFrame(flush);
      };

      await streamRequest(
        '/api/chat/stream',
        {
          modelId: model.id,
          messages: toApiMessages(history),
          systemPrompt: base.systemPrompt,
          params: base.params,
        },
        {
          onDelta: (t) => {
            acc += t;
            schedule();
          },
          onReasoning: (t) => {
            reasoning += t;
            schedule();
          },
          onDone: (e) => {
            finalMetrics = e.metrics || null;
          },
          onError: (msg) => {
            failure = msg;
          },
        },
        controller.signal,
      );

      if (raf) cancelAnimationFrame(raf);
      abortRef.current = null;
      setStreaming(false);

      const finished: Conversation = {
        ...base,
        messages: base.messages.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: acc,
                reasoning: reasoning || undefined,
                metrics: finalMetrics || { ...EMPTY_METRICS, latencyMs: 0 },
                error: failure || undefined,
                modelId: model.id,
                modelName: model.name,
              }
            : m,
        ),
      };
      setConv(finished);
      scrollToBottom(true);
      await persist(finished);
      if (failure) pushToast('err', `生成失败：${failure}`);
    },
    [enabledModels, modelById, persist, pushToast, scrollToBottom],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!conv || !text || streaming) return;
    const model = modelById(conv.modelId) || enabledModels[0];
    if (!model) return pushToast('err', '请先在「模型接入」中添加并启用模型');

    const userMsg: ChatMessage = { id: uid('m'), role: 'user', content: text, createdAt: new Date().toISOString() };
    const assistantMsg: ChatMessage = {
      id: uid('m'),
      role: 'assistant',
      content: '',
      modelId: model.id,
      modelName: model.name,
      createdAt: new Date().toISOString(),
    };
    const history = [...conv.messages, userMsg];
    const next: Conversation = {
      ...conv,
      title: conv.title === '新对话' ? text.slice(0, 24) : conv.title,
      messages: [...history, assistantMsg],
    };
    setConv(next);
    setInput('');
    await persist(next);
    await runStream(next, history, assistantMsg.id);
  }, [conv, enabledModels, input, modelById, persist, pushToast, runStream, streaming]);

  const regenerate = useCallback(async () => {
    if (!conv || streaming) return;
    const messages = [...conv.messages];
    while (messages.length && messages[messages.length - 1].role === 'assistant') messages.pop();
    if (!messages.length) return;
    const placeholder: ChatMessage = {
      id: uid('m'),
      role: 'assistant',
      content: '',
      modelId: conv.modelId,
      modelName: modelById(conv.modelId)?.name,
      createdAt: new Date().toISOString(),
    };
    const next: Conversation = { ...conv, messages: [...messages, placeholder] };
    setConv(next);
    await runStream(next, messages, placeholder.id);
  }, [conv, modelById, runStream, streaming]);

  const stop = () => {
    abortRef.current?.abort();
    setStreaming(false);
  };

  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!(await confirm({ title: '删除对话', message: '删除后无法恢复，确定继续吗？', danger: true, confirmText: '删除' }))) return;
    await api.deleteConversation(id);
    if (conv?.id === id) setConv(null);
    loadList();
  };

  const deleteMessage = async (id: string) => {
    if (!conv) return;
    const next = { ...conv, messages: conv.messages.filter((m) => m.id !== id) };
    setConv(next);
    await persist(next);
  };

  const filteredList = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? list.filter((c) => c.title.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q)) : list;
  }, [list, query]);

  const totals = useMemo(() => {
    const msgs = conv?.messages || [];
    return {
      tokens: msgs.reduce((a, m) => a + (m.metrics?.totalTokens || 0), 0),
      cost: msgs.reduce((a, m) => a + (m.metrics?.cost || 0), 0),
      count: msgs.filter((m) => m.role === 'assistant' && m.content).length,
    };
  }, [conv]);

  const currentModel = conv ? modelById(conv.modelId) : undefined;

  return (
    <div className="chat-layout">
      {/* 左：会话列表 */}
      <aside className="chat-side">
        <div className="side-head">
          <Button variant="primary" icon={<IconPlus size={15} />} onClick={createConversation} className="btn-block">
            新建对话
          </Button>
          <div style={{ position: 'relative' }}>
            <IconSearch size={14} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--text-faint)' }} />
            <input
              className="input input-sm"
              style={{ paddingLeft: 30 }}
              placeholder="搜索会话"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="side-scroll">
          {filteredList.length === 0 ? (
            <div className="empty small" style={{ padding: '26px 12px' }}>
              暂无会话
            </div>
          ) : (
            filteredList.map((c) => (
              <div key={c.id} className={`conv-item ${conv?.id === c.id ? 'active' : ''}`} onClick={() => openConversation(c.id)}>
                <div className="row" style={{ gap: 6 }}>
                  <span className="small bold truncate grow">{c.title || '新对话'}</span>
                  <button className="btn btn-ghost btn-xs conv-del" onClick={(e) => deleteConversation(c.id, e)} title="删除">
                    <IconTrash size={12} />
                  </button>
                </div>
                <div className="xsmall faint truncate">{c.preview || `${c.messageCount} 条消息`}</div>
                <div className="xsmall faint">{timeAgo(c.updatedAt)}</div>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* 中：消息区 */}
      <section className="chat-main">
        {!conv ? (
          <div className="center grow">
            <Empty
              icon={<IconChat size={22} />}
              title="开始一段新对话"
              desc="左侧点击「新建对话」即可开始。每个会话独立保存模型、系统提示与采样参数。"
              action={
                <Button variant="primary" icon={<IconPlus size={15} />} onClick={createConversation}>
                  新建对话
                </Button>
              }
            />
          </div>
        ) : (
          <>
            <div
              className="chat-scroll"
              ref={scrollRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              }}
            >
              {loading ? (
                <div className="row muted">
                  <Spinner /> 加载中…
                </div>
              ) : null}
              {conv.messages.length === 0 ? (
                <Empty icon={<IconChat size={20} />} title="还没有消息" desc="在下方输入框提问，回车发送，Shift + 回车换行。" />
              ) : null}
              {conv.messages.map((m, idx) => {
                const isLast = idx === conv.messages.length - 1;
                if (m.role === 'user') {
                  return (
                    <div className="msg user" key={m.id}>
                      <div className="avatar me">我</div>
                      <div className="bubble">
                        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.content}</div>
                        <div className="msg-actions" style={{ justifyContent: 'flex-end' }}>
                          <CopyButton text={m.content} />
                          <Button size="xs" variant="ghost" title="删除该条" onClick={() => deleteMessage(m.id)}>
                            <IconTrash size={13} />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                }
                return (
                  <div className="msg" key={m.id}>
                    <div className="avatar ai">AI</div>
                    <div className="bubble">
                      <div className="msg-head">
                        <span className="bold" style={{ color: 'var(--text-dim)' }}>
                          {m.modelName || currentModel?.name || '助手'}
                        </span>
                        {m.metrics && !m.error ? (
                          <>
                            <span>·</span>
                            <span title="总耗时">
                              <IconClock size={11} style={{ verticalAlign: -1 }} /> {formatMs(m.metrics.latencyMs)}
                            </span>
                            <span>·</span>
                            <span title="首字延迟 / 输出 tokens">
                              <IconGauge size={11} style={{ verticalAlign: -1 }} /> {formatMs(m.metrics.ttftMs)} /{' '}
                              {formatTokens(m.metrics.completionTokens)}
                            </span>
                            {m.metrics.cost > 0 ? (
                              <>
                                <span>·</span>
                                <span title="预估成本">
                                  <IconCoin size={11} style={{ verticalAlign: -1 }} /> {formatCost(m.metrics.cost)}
                                </span>
                              </>
                            ) : null}
                          </>
                        ) : null}
                      </div>

                      {m.reasoning ? (
                        <details className="reasoning" open={false}>
                          <summary style={{ cursor: 'pointer', fontSize: 12 }}>思考过程</summary>
                          <div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{m.reasoning}</div>
                        </details>
                      ) : null}

                      {m.error ? (
                        <div className="row" style={{ gap: 8, color: 'var(--err)' }}>
                          <IconAlert size={15} />
                          <span className="small">{m.error}</span>
                        </div>
                      ) : m.content ? (
                        <Markdown>{m.content}</Markdown>
                      ) : streaming && isLast ? (
                        <span className="row small muted" style={{ gap: 8 }}>
                          <Spinner size={13} /> 正在生成…
                        </span>
                      ) : (
                        <span className="small faint">（空回复）</span>
                      )}

                      {streaming && isLast && m.content ? <span className="caret" /> : null}

                      {!streaming || !isLast ? (
                        <div className="msg-actions">
                          <CopyButton text={m.content} />
                          {isLast ? (
                            <Button size="xs" variant="ghost" title="重新生成" onClick={regenerate}>
                              <IconRefresh size={13} />
                              重新生成
                            </Button>
                          ) : null}
                          <Button size="xs" variant="ghost" title="删除该条" onClick={() => deleteMessage(m.id)}>
                            <IconTrash size={13} />
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="composer">
              <div className="composer-box">
                <AutoTextarea
                  value={input}
                  onChange={setInput}
                  onSubmit={send}
                  placeholder={
                    enabledModels.length ? `向 ${currentModel?.name || '模型'} 提问…（Enter 发送，Shift+Enter 换行）` : '请先接入模型'
                  }
                  disabled={streaming}
                  maxHeight={200}
                />
                <div className="row between">
                  <span className="xsmall faint">
                    {conv.messages.length} 条消息 · 累计 {formatTokens(totals.tokens)} tokens
                    {totals.cost > 0 ? ` · ${formatCost(totals.cost)}` : ''}
                  </span>
                  {streaming ? (
                    <Button variant="danger" size="sm" icon={<IconStop size={13} />} onClick={stop}>
                      停止
                    </Button>
                  ) : (
                    <Button variant="primary" size="sm" icon={<IconSend size={14} />} onClick={send} disabled={!input.trim()}>
                      发送
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {/* 右：参数面板 */}
      <aside className="chat-side right">
        <div className="side-head">
          <div className="panel-title row" style={{ gap: 6 }}>
            <IconSliders size={13} /> 会话设置
          </div>
        </div>
        <div className="side-scroll col" style={{ gap: 13, padding: '4px 12px 16px' }}>
          {!conv ? (
            <div className="hint">选择或新建一个会话后可调整参数。</div>
          ) : (
            <>
              <Field label="模型">
                <select
                  className="select"
                  value={conv.modelId}
                  onChange={async (e) => {
                    const next = { ...conv, modelId: e.target.value };
                    setConv(next);
                    await api.saveConversation(next.id, { modelId: next.modelId });
                  }}
                >
                  {enabledModels.length === 0 ? <option value="">（无可用模型）</option> : null}
                  {enabledModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>

              {currentModel ? (
                <div className="row wrap" style={{ gap: 6 }}>
                  <Badge kind={PROVIDER_BADGE[currentModel.provider]}>{PROVIDER_LABEL[currentModel.provider]}</Badge>
                  <span className="mono xsmall faint truncate" title={currentModel.model}>
                    {currentModel.model}
                  </span>
                </div>
              ) : null}

              <Field label="系统提示词">
                <textarea
                  className="textarea"
                  style={{ minHeight: 96, fontSize: 12.5 }}
                  placeholder="例如：你是一位严谨的技术评审，回答要给出依据。"
                  value={conv.systemPrompt}
                  onChange={(e) => setConv({ ...conv, systemPrompt: e.target.value })}
                  onBlur={() => api.saveConversation(conv.id, { systemPrompt: conv.systemPrompt })}
                />
              </Field>

              <Field label={`Temperature：${conv.params?.temperature ?? 0.7}`}>
                <input
                  className="range"
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={conv.params?.temperature ?? 0.7}
                  onChange={(e) => setConv({ ...conv, params: { ...conv.params, temperature: Number(e.target.value) } })}
                  onMouseUp={() => api.saveConversation(conv.id, { params: conv.params })}
                />
              </Field>

              <Field label="最大输出 Tokens">
                <input
                  className="input input-sm"
                  type="number"
                  min={1}
                  step={128}
                  value={conv.params?.maxTokens ?? 2048}
                  onChange={(e) => setConv({ ...conv, params: { ...conv.params, maxTokens: Number(e.target.value) } })}
                  onBlur={() => api.saveConversation(conv.id, { params: conv.params })}
                />
              </Field>

              <div className="divider" />
              <div className="panel-title">会话统计</div>
              <div className="grid grid-2" style={{ gap: 8 }}>
                <div className="metric">
                  <span className="metric-k">轮次</span>
                  <span className="metric-v">{totals.count}</span>
                </div>
                <div className="metric">
                  <span className="metric-k">Tokens</span>
                  <span className="metric-v">{formatTokens(totals.tokens)}</span>
                </div>
                <div className="metric">
                  <span className="metric-k">预估成本</span>
                  <span className="metric-v">{formatCost(totals.cost)}</span>
                </div>
                <div className="metric">
                  <span className="metric-k">平均耗时</span>
                  <span className="metric-v">
                    {totals.count
                      ? formatMs(
                          (conv.messages.reduce((a, m) => a + (m.metrics?.latencyMs || 0), 0) / totals.count) as number,
                        )
                      : '—'}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
