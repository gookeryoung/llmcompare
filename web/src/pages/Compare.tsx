import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, streamRequest } from '../api';
import { useApp } from '../state';
import type { Metrics, ModelConfig, Question } from '../types';
import { PROVIDER_BADGE, PROVIDER_LABEL, downloadFile, formatCost, formatMs, formatNumber, formatTokens, stamp } from '../lib/format';
import { Badge, Button, Empty, Field, Modal, Segmented, Spinner, Switch, useConfirm } from '../components/ui';
import { JudgePanel, MetricsTable, ResultColumn, statusBadge, type LiveResult } from '../components/ResultGrid';
import {
  IconColumns,
  IconDownload,
  IconGauge,
  IconPlay,
  IconRefresh,
  IconSave,
  IconScale,
  IconSliders,
  IconStop,
  IconZap,
  IconLibrary,
  IconTrash,
} from '../components/Icons';

type ViewMode = 'columns' | 'metrics' | 'table';
type SortMode = 'default' | 'score' | 'latency' | 'ttft' | 'tokens';

interface JudgeState {
  loading: boolean;
  raw: string;
  data: any;
  error?: string;
  modelName?: string;
}

export default function ComparePage() {
  const { enabledModels, modelById, banks, compareDraft, setCompareDraft, pushToast, settings, navigate } = useApp();
  const confirm = useConfirm();

  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [questionId, setQuestionId] = useState<string | undefined>();
  const [rubric, setRubric] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [params, setParams] = useState({ temperature: 0.7, topP: 1, maxTokens: 2048 });
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, LiveResult>>({});
  const [running, setRunning] = useState(false);
  const [, setTick] = useState(0);
  const [view, setView] = useState<ViewMode>('columns');
  const [sortBy, setSortBy] = useState<SortMode>('default');
  const [syncScroll, setSyncScroll] = useState(true);
  const [judge, setJudge] = useState<JudgeState | null>(null);
  const [judgeModelId, setJudgeModelId] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [queue, setQueue] = useState<NonNullable<typeof compareDraft>['queue']>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showModels, setShowModels] = useState(true);
  const [pickBank, setPickBank] = useState('');
  const [bankQuestions, setBankQuestions] = useState<Question[]>([]);
  const [initialized, setInitialized] = useState(false);

  const buffers = useRef<Record<string, { text: string; reasoning: string }>>({});
  const controllers = useRef<Record<string, AbortController>>({});
  const dirty = useRef<Set<string>>(new Set());
  const rafRef = useRef(0);
  const startedAt = useRef<Record<string, number>>({});
  const bodyRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const stick = useRef<Record<string, boolean>>({});
  const syncing = useRef(false);
  const resultRef = useRef<HTMLDivElement | null>(null);

  /* ------------------------------ 初始化 ------------------------------ */

  useEffect(() => {
    if (settings && !initialized) {
      setParams({ ...settings.defaultParams });
      setJudgeModelId(settings.judgeModelId || '');
      setInitialized(true);
    }
  }, [settings, initialized]);

  useEffect(() => {
    if (selected.length === 0 && enabledModels.length) setSelected(enabledModels.map((m) => m.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledModels.length]);

  useEffect(() => {
    if (compareDraft) {
      setQuestion(compareDraft.question);
      setQuestionId(compareDraft.questionId);
      setTitle(compareDraft.title || '');
      setRubric(compareDraft.rubric || '');
      setQueue(compareDraft.queue || []);
      setResults({});
      setRunId(null);
      setJudge(null);
      setCompareDraft(null);
    }
  }, [compareDraft, setCompareDraft]);

  useEffect(() => {
    if (!pickBank && banks.length) setPickBank(banks[0].id);
  }, [banks, pickBank]);

  useEffect(() => {
    if (!pickBank) return;
    api.listQuestions({ bankId: pickBank }).then(setBankQuestions).catch(() => setBankQuestions([]));
  }, [pickBank]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((t) => t + 1), 120);
    return () => clearInterval(id);
  }, [running]);

  /* --------------------------- 流式刷新（rAF） --------------------------- */

  const flush = useCallback(() => {
    rafRef.current = 0;
    const ids = [...dirty.current];
    dirty.current = new Set();
    if (!ids.length) return;
    setResults((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        const b = buffers.current[id];
        if (b && next[id]) next[id] = { ...next[id], text: b.text, reasoning: b.reasoning };
      }
      return next;
    });
  }, []);

  const schedule = useCallback(
    (id: string) => {
      dirty.current.add(id);
      if (!rafRef.current) rafRef.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  useEffect(() => {
    if (!running) return;
    for (const [id, el] of Object.entries(bodyRefs.current)) {
      if (el && stick.current[id] !== false) el.scrollTop = el.scrollHeight;
    }
  }, [results, running]);

  /* ------------------------------- 运行 ------------------------------- */

  const runOne = useCallback(
    async (model: ModelConfig, q: string, sys: string, p: typeof params) => {
      buffers.current[model.id] = { text: '', reasoning: '' };
      startedAt.current[model.id] = Date.now();
      stick.current[model.id] = true;
      setResults((prev) => ({
        ...prev,
        [model.id]: {
          modelId: model.id,
          modelName: model.name,
          provider: model.provider,
          color: model.color,
          text: '',
          reasoning: '',
          metrics: null,
          status: 'running',
          score: prev[model.id]?.score ?? null,
          note: prev[model.id]?.note,
        },
      }));

      const controller = new AbortController();
      controllers.current[model.id] = controller;
      let failure = '';
      let metrics: Metrics | null = null;
      let aborted = false;

      await streamRequest(
        '/api/run/stream',
        { modelId: model.id, question: q, systemPrompt: sys, params: p },
        {
          onDelta: (t) => {
            buffers.current[model.id].text += t;
            schedule(model.id);
          },
          onReasoning: (t) => {
            buffers.current[model.id].reasoning += t;
            schedule(model.id);
          },
          onDone: (e) => {
            metrics = e.metrics || null;
            if (e.aborted) aborted = true;
          },
          onError: (msg) => {
            failure = msg;
          },
        },
        controller.signal,
      );

      if (controller.signal.aborted) aborted = true;
      delete controllers.current[model.id];
      const buf = buffers.current[model.id] || { text: '', reasoning: '' };
      setResults((prev) => ({
        ...prev,
        [model.id]: {
          ...(prev[model.id] as LiveResult),
          text: buf.text,
          reasoning: buf.reasoning,
          metrics,
          error: failure || undefined,
          status: failure ? 'error' : aborted ? 'aborted' : 'ok',
        },
      }));
    },
    [schedule],
  );

  const runAll = useCallback(
    async (overrideQuestion?: string) => {
      const q = (overrideQuestion ?? question).trim();
      if (!q) return pushToast('err', '请先填写要对比的问题');
      const targets = selected.map((id) => modelById(id)).filter(Boolean) as ModelConfig[];
      if (targets.length < 1) return pushToast('err', '请至少选择一个模型');
      if (targets.length === 1) pushToast('info', '只选择了一个模型，建议多选几个才能体现横向对比价值');

      setRunning(true);
      setJudge(null);
      setRunId(null);
      const seed: Record<string, LiveResult> = {};
      for (const m of targets) {
        seed[m.id] = {
          modelId: m.id,
          modelName: m.name,
          provider: m.provider,
          color: m.color,
          text: '',
          status: 'running',
          metrics: null,
        };
      }
      setResults(seed);
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      await Promise.all(targets.map((m) => runOne(m, q, systemPrompt, params)));
      setRunning(false);
    },
    [modelById, params, pushToast, question, runOne, selected, systemPrompt],
  );

  const stopAll = () => {
    Object.values(controllers.current).forEach((c) => c.abort());
    setRunning(false);
  };

  /* ------------------------------ 排序/视图 ----------------------------- */

  const ordered = useMemo(() => {
    const arr = selected.map((id) => results[id]).filter(Boolean) as LiveResult[];
    const score = (r: LiveResult) => r.judgeScore ?? (r.score ? r.score * 2 : -1);
    if (sortBy === 'score') arr.sort((a, b) => score(b) - score(a));
    else if (sortBy === 'latency') arr.sort((a, b) => (a.metrics?.latencyMs || 1e9) - (b.metrics?.latencyMs || 1e9));
    else if (sortBy === 'ttft') arr.sort((a, b) => (a.metrics?.ttftMs ?? 1e9) - (b.metrics?.ttftMs ?? 1e9));
    else if (sortBy === 'tokens') arr.sort((a, b) => (b.metrics?.completionTokens || 0) - (a.metrics?.completionTokens || 0));
    return arr;
  }, [results, selected, sortBy]);

  const rankMap = useMemo(() => {
    const map: Record<string, number> = {};
    const scored = ordered.filter((r) => (r.judgeScore ?? 0) > 0);
    if (scored.length) {
      [...scored]
        .sort((a, b) => (b.judgeScore || 0) - (a.judgeScore || 0))
        .forEach((r, i) => {
          map[r.modelId] = i + 1;
        });
    } else {
      const withScore = ordered.filter((r) => (r.score || 0) > 0);
      [...withScore].sort((a, b) => (b.score || 0) - (a.score || 0)).forEach((r, i) => {
        map[r.modelId] = i + 1;
      });
    }
    return map;
  }, [ordered]);

  /* ------------------------------- 交互 ------------------------------- */

  const updateResult = (modelId: string, patch: Partial<LiveResult>) =>
    setResults((prev) => (prev[modelId] ? { ...prev, [modelId]: { ...prev[modelId], ...patch } } : prev));

  const onScrollColumn = (id: string): React.UIEventHandler<HTMLDivElement> => (e) => {
    const el = e.currentTarget;
    stick.current[id] = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (!syncScroll || syncing.current) return;
    syncing.current = true;
    const ratio = el.scrollHeight > el.clientHeight ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 0;
    for (const [otherId, other] of Object.entries(bodyRefs.current)) {
      if (otherId === id || !other) continue;
      other.scrollTop = ratio * Math.max(0, other.scrollHeight - other.clientHeight);
    }
    setTimeout(() => {
      syncing.current = false;
    }, 40);
  };

  const runJudge = async () => {
    const done = ordered.filter((r) => r.status === 'ok' && r.text.trim());
    if (done.length < 2) return pushToast('err', '至少需要两个成功返回的回答才能做裁判对比');
    const judgeModel = modelById(judgeModelId) || enabledModels[0];
    if (!judgeModel) return pushToast('err', '请先接入一个可用模型作为裁判');
    setJudge({ loading: true, raw: '', data: null, modelName: judgeModel.name });
    let raw = '';
    await streamRequest(
      '/api/judge',
      {
        judgeModelId: judgeModel.id,
        question,
        rubric,
        candidates: done.map((r) => ({ modelName: r.modelName, text: r.text })),
      },
      {
        onDelta: (t) => {
          raw += t;
          setJudge((j) => (j ? { ...j, raw } : j));
        },
        onEvent: (e) => {
          if (e.type === 'result') {
            const data = e.data;
            setJudge({ loading: false, raw: e.raw || raw, data, modelName: judgeModel.name });
            if (data?.ranking) {
              setResults((prev) => {
                const next = { ...prev };
                for (const item of data.ranking) {
                  const target = done[item.index - 1];
                  if (target && next[target.modelId]) {
                    next[target.modelId] = { ...next[target.modelId], judgeScore: Number(item.score) || 0, judgeComment: item.comment || '' };
                  }
                }
                return next;
              });
              pushToast('ok', '裁判评分已应用到各模型');
            } else {
              pushToast('err', '裁判输出无法解析为 JSON，请查看原始输出');
            }
          } else if (e.type === 'error') {
            setJudge({ loading: false, raw, data: null, error: e.message, modelName: judgeModel.name });
          }
        },
        onError: (msg) => setJudge({ loading: false, raw, data: null, error: msg, modelName: judgeModel.name }),
      },
    );
  };

  /* ------------------------------- 导出 ------------------------------- */

  const exportRows = () =>
    ordered.map((r) => ({
      model: r.modelName,
      provider: r.provider ? PROVIDER_LABEL[r.provider] || r.provider : '',
      status: r.status,
      ttft: r.metrics?.ttftMs ?? '',
      latency: r.metrics?.latencyMs ?? '',
      outTokens: r.metrics?.completionTokens ?? '',
      totalTokens: r.metrics?.totalTokens ?? '',
      speed: r.metrics?.charsPerSec ?? '',
      cost: r.metrics?.cost ?? '',
      chars: r.text.length,
      score: r.score ?? '',
      judgeScore: r.judgeScore ?? '',
      note: r.note || '',
      answer: r.text,
      error: r.error || '',
    }));

  const exportCsv = () => {
    const headers = [
      ['model', '模型'],
      ['provider', '协议'],
      ['status', '状态'],
      ['ttft', '首字(ms)'],
      ['latency', '耗时(ms)'],
      ['outTokens', '输出Tokens'],
      ['totalTokens', '总Tokens'],
      ['speed', '速度(字符/秒)'],
      ['cost', '预估成本($)'],
      ['chars', '字数'],
      ['score', '人工评分'],
      ['judgeScore', '裁判评分'],
      ['note', '备注'],
      ['answer', '回答'],
      ['error', '错误'],
    ] as [string, string][];
    const esc = (v: any) => {
      const s = v == null ? '' : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = exportRows();
    const csv = [headers.map((h) => h[1]).join(','), ...rows.map((row) => headers.map((h) => esc((row as any)[h[0]])).join(','))].join('\n');
    downloadFile(`对比结果-${stamp()}.csv`, `\uFEFF${csv}`, 'text/csv;charset=utf-8');
  };

  const exportMarkdown = () => {
    const lines: string[] = [];
    lines.push(`# 多模型横向对比`);
    lines.push('');
    lines.push(`- 时间：${new Date().toLocaleString('zh-CN')}`);
    lines.push(`- 问题：${question.replace(/\n/g, ' ')}`);
    if (rubric) lines.push(`- 评分要点：${rubric}`);
    lines.push('');
    lines.push('| 模型 | 状态 | 首字 | 耗时 | 输出 Tokens | 速度 | 成本 | 字数 | 评分 | 裁判 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of ordered) {
      lines.push(
        `| ${r.modelName} | ${r.status} | ${formatMs(r.metrics?.ttftMs)} | ${formatMs(r.metrics?.latencyMs)} | ${r.metrics?.completionTokens ?? '-'} | ${
          r.metrics?.charsPerSec ? `${formatNumber(r.metrics.charsPerSec, 1)} c/s` : '-'
        } | ${r.metrics?.cost ? formatCost(r.metrics.cost) : '-'} | ${r.text.length} | ${r.score ?? '-'} | ${r.judgeScore ?? '-'} |`,
      );
    }
    lines.push('');
    for (const r of ordered) {
      lines.push(`## ${r.modelName}`);
      lines.push('');
      if (r.error) lines.push(`> 错误：${r.error}`);
      lines.push(r.text || '（无输出）');
      if (r.note) lines.push(`\n> 备注：${r.note}`);
      if (r.judgeComment) lines.push(`\n> 裁判点评：${r.judgeComment}`);
      lines.push('');
      lines.push('---');
      lines.push('');
    }
    downloadFile(`对比结果-${stamp()}.md`, lines.join('\n'), 'text/markdown;charset=utf-8');
  };

  const exportJson = () => {
    downloadFile(
      `对比结果-${stamp()}.json`,
      JSON.stringify({ question, rubric, systemPrompt, params, results: exportRows(), judge: judge?.data || null }, null, 2),
      'application/json;charset=utf-8',
    );
  };

  /* ------------------------------- 保存 ------------------------------- */

  const saveRun = async () => {
    const payload = {
      title: title || question.slice(0, 30) || '未命名对比',
      question,
      questionId,
      rubric,
      systemPrompt,
      params,
      status: 'done',
      results: ordered.map((r) => ({
        modelId: r.modelId,
        modelName: r.modelName,
        provider: r.provider,
        text: r.text,
        reasoning: r.reasoning,
        metrics: r.metrics || { latencyMs: 0, ttftMs: null, promptTokens: 0, completionTokens: 0, totalTokens: 0, chars: 0, charsPerSec: 0, cost: 0, finishReason: '' },
        status: r.status === 'running' || r.status === 'idle' ? 'aborted' : r.status,
        error: r.error,
        score: r.score ?? null,
        note: r.note,
      })),
      judge: judge?.data
        ? {
            judgeModelId,
            judgeModelName: judge.modelName || '',
            summary: judge.data.summary || '',
            best: judge.data.best || '',
            ranking: judge.data.ranking || [],
            at: new Date().toISOString(),
          }
        : null,
    };
    try {
      if (runId) {
        await api.updateRun(runId, payload);
        pushToast('ok', '评测记录已更新');
      } else {
        const created = await api.saveRun(payload);
        setRunId(created.id);
        pushToast('ok', '评测记录已保存，可在「评测记录」中查看');
      }
    } catch (err: any) {
      pushToast('err', `保存失败：${err.message}`);
    }
  };

  const nextQuestion = () => {
    if (!queue?.length) return;
    const [head, ...rest] = queue;
    setQuestion(head.question);
    setQuestionId(head.questionId);
    setTitle(head.title || '');
    setRubric(head.rubric || '');
    setQueue(rest);
    setResults({});
    setRunId(null);
    setJudge(null);
    pushToast('ok', `已载入下一题，剩余 ${rest.length} 题`);
  };

  const clearResults = async () => {
    if (ordered.length && !(await confirm({ title: '清空结果', message: '将清空当前所有模型的输出与评分，确定吗？', danger: true, confirmText: '清空' }))) return;
    setResults({});
    setJudge(null);
    setRunId(null);
  };

  const finishedCount = ordered.filter((r) => r.status === 'ok' || r.status === 'error' || r.status === 'aborted').length;

  /* -------------------------------- 渲染 -------------------------------- */

  return (
    <div className="col" style={{ gap: 14 }}>
      {/* 题目与参数 */}
      <div className="card card-pad col" style={{ gap: 13 }}>
        <div className="row between wrap" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <IconColumns size={16} style={{ color: 'var(--accent-hi)' }} />
            <span className="bold">对比任务设置</span>
            {questionId ? <Badge kind="badge-accent">来自题库</Badge> : null}
          </div>
          <div className="row" style={{ gap: 8 }}>
            {queue?.length ? (
              <Button size="sm" icon={<IconLibrary size={13} />} onClick={nextQuestion}>
                下一题（剩 {queue.length}）
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" icon={<IconSliders size={13} />} onClick={() => setShowAdvanced((v) => !v)}>
              {showAdvanced ? '收起高级设置' : '高级设置'}
            </Button>
          </div>
        </div>

        <div className="row wrap" style={{ gap: 8 }}>
          <select className="select input-sm" style={{ width: 170 }} value={pickBank} onChange={(e) => setPickBank(e.target.value)}>
            <option value="">从题库选择…</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select
            className="select input-sm"
            style={{ flex: 1, minWidth: 240 }}
            value=""
            onChange={(e) => {
              const q = bankQuestions.find((x) => x.id === e.target.value);
              if (!q) return;
              setQuestion(q.content);
              setQuestionId(q.id);
              setTitle(q.title || '');
              setRubric(q.rubric || '');
            }}
          >
            <option value="">{bankQuestions.length ? `该题库共 ${bankQuestions.length} 题，点击选择` : '（该题库暂无题目）'}</option>
            {bankQuestions.map((q) => (
              <option key={q.id} value={q.id}>
                {(q.title ? `${q.title} — ` : '') + q.content.replace(/\s+/g, ' ').slice(0, 60)}
              </option>
            ))}
          </select>
          <Button size="sm" variant="ghost" onClick={() => navigate('questions')}>
            管理题库
          </Button>
        </div>

        <Field label="问题内容" hint="该内容会原样发送给每一个选中的模型。">
          <textarea
            className="textarea"
            style={{ minHeight: 96 }}
            value={question}
            onChange={(e) => {
              setQuestion(e.target.value);
              setQuestionId(undefined);
            }}
            placeholder="输入要在多个模型之间对比的问题…"
          />
        </Field>

        {showAdvanced ? (
          <div className="grid grid-3">
            <Field label="系统提示词（可选）">
              <textarea
                className="textarea"
                style={{ minHeight: 76, fontSize: 12.5 }}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="例如：请用要点回答，不要超过 200 字。"
              />
            </Field>
            <Field label="评分要点（供 AI 裁判参考）">
              <textarea
                className="textarea"
                style={{ minHeight: 76, fontSize: 12.5 }}
                value={rubric}
                onChange={(e) => setRubric(e.target.value)}
                placeholder="例如：必须给出可运行代码，并说明时间复杂度。"
              />
            </Field>
            <div className="col" style={{ gap: 10 }}>
              <Field label={`Temperature：${params.temperature}`}>
                <input
                  className="range"
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={params.temperature}
                  onChange={(e) => setParams({ ...params, temperature: Number(e.target.value) })}
                />
              </Field>
              <Field label="最大输出 Tokens">
                <input
                  className="input input-sm"
                  type="number"
                  min={1}
                  step={128}
                  value={params.maxTokens}
                  onChange={(e) => setParams({ ...params, maxTokens: Number(e.target.value) })}
                />
              </Field>
            </div>
          </div>
        ) : null}
      </div>

      {/* 模型选择 */}
      <div className="card card-pad col" style={{ gap: 11 }}>
        <div className="row between wrap" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 8 }}>
            <IconZap size={16} style={{ color: 'var(--accent-hi)' }} />
            <span className="bold">参与对比的模型</span>
            <Badge kind={selected.length ? 'badge-accent' : ''}>已选 {selected.length}</Badge>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <Button size="xs" onClick={() => setSelected(enabledModels.map((m) => m.id))}>
              全选
            </Button>
            <Button size="xs" onClick={() => setSelected([])}>
              清空
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setShowModels((v) => !v)}>
              {showModels ? '收起' : '展开'}
            </Button>
          </div>
        </div>

        {showModels ? (
          enabledModels.length === 0 ? (
            <Empty
              icon={<IconZap size={20} />}
              title="还没有可用的模型"
              desc="先到「模型接入」添加模型，或使用内置模拟模型体验流程。"
              action={
                <Button variant="primary" onClick={() => navigate('models')}>
                  去接入模型
                </Button>
              }
            />
          ) : (
            <div className="grid grid-3" style={{ gap: 8 }}>
              {enabledModels.map((m) => {
                const on = selected.includes(m.id);
                return (
                  <label key={m.id} className={`model-pick ${on ? 'on' : ''}`} style={{ padding: '9px 11px' }}>
                    <input
                      type="checkbox"
                      className="checkbox"
                      style={{ marginTop: 2 }}
                      checked={on}
                      onChange={() =>
                        setSelected((prev) => (on ? prev.filter((x) => x !== m.id) : [...prev, m.id]))
                      }
                    />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <span className="small bold truncate">{m.name}</span>
                      </div>
                      <div className="row wrap" style={{ gap: 5, marginTop: 3 }}>
                        <Badge kind={PROVIDER_BADGE[m.provider]}>{PROVIDER_LABEL[m.provider]}</Badge>
                        <span className="xsmall faint mono truncate" title={m.model}>
                          {m.model}
                        </span>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )
        ) : null}
      </div>

      {/* 操作栏 */}
      <div className="card card-pad row wrap between" style={{ gap: 10, position: 'sticky', top: 0, zIndex: 8 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          {running ? (
            <Button variant="danger" icon={<IconStop size={14} />} onClick={stopAll}>
              停止全部
            </Button>
          ) : (
            <Button variant="primary" icon={<IconPlay size={14} />} onClick={() => runAll()} disabled={!enabledModels.length}>
              开始对比（{selected.length} 个模型）
            </Button>
          )}
          {ordered.length ? (
            <>
              <span className="small muted nowrap">
                {finishedCount}/{ordered.length} 已完成
              </span>
              <Button size="sm" icon={<IconSave size={13} />} onClick={saveRun} disabled={running}>
                保存记录
              </Button>
              <Button size="sm" variant="ghost" icon={<IconTrash size={13} />} onClick={clearResults} disabled={running}>
                清空
              </Button>
            </>
          ) : null}
        </div>

        <div className="row wrap" style={{ gap: 8 }}>
          <select className="select input-sm" style={{ width: 132 }} value={judgeModelId} onChange={(e) => setJudgeModelId(e.target.value)}>
            <option value="">裁判模型…</option>
            {enabledModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <Button size="sm" icon={<IconScale size={13} />} onClick={runJudge} disabled={running || ordered.filter((r) => r.status === 'ok').length < 2}>
            AI 裁判
          </Button>
          <div className="row" style={{ gap: 8 }}>
            <span className="xsmall faint nowrap">同步滚动</span>
            <Switch checked={syncScroll} onChange={setSyncScroll} />
          </div>
          <select className="select input-sm" style={{ width: 118 }} value={sortBy} onChange={(e) => setSortBy(e.target.value as SortMode)}>
            <option value="default">默认顺序</option>
            <option value="score">按评分</option>
            <option value="latency">按耗时</option>
            <option value="ttft">按首字</option>
            <option value="tokens">按输出量</option>
          </select>
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'columns', label: '并排' },
              { value: 'metrics', label: '指标' },
              { value: 'table', label: '表格' },
            ]}
          />
          <div style={{ position: 'relative' }}>
            <Button size="sm" icon={<IconDownload size={13} />} onClick={exportCsv} disabled={!ordered.length}>
              导出 CSV
            </Button>
          </div>
          <Button size="sm" variant="ghost" onClick={exportMarkdown} disabled={!ordered.length}>
            Markdown
          </Button>
          <Button size="sm" variant="ghost" onClick={exportJson} disabled={!ordered.length}>
            JSON
          </Button>
        </div>
      </div>

      {judge ? <JudgePanel judge={judge} results={ordered} onClose={() => setJudge(null)} /> : null}

      {/* 结果 */}
      <div ref={resultRef} style={{ scrollMarginTop: 12 }} />
      {ordered.length === 0 ? (
        <div className="card">
          <Empty
            icon={<IconGauge size={22} />}
            title="还没有对比结果"
            desc="选择题目与模型后点击「开始对比」，所有模型会并行流式输出，便于直观比较速度、长度与质量。"
          />
        </div>
      ) : view === 'columns' ? (
        <div
          className="compare-grid"
          style={{ gridTemplateColumns: `repeat(${Math.min(ordered.length, 3)}, minmax(0, 1fr))` }}
        >
          {ordered.map((r) => (
            <ResultColumn
              key={r.modelId}
              r={r}
              rank={rankMap[r.modelId]}
              live
              onScore={(v) => updateResult(r.modelId, { score: v })}
              onNote={(v) => updateResult(r.modelId, { note: v })}
              onRerun={() => {
                const m = modelById(r.modelId);
                if (m) runOne(m, question, systemPrompt, params);
              }}
              onRemove={() => {
                setSelected((prev) => prev.filter((x) => x !== r.modelId));
                setResults((prev) => {
                  const next = { ...prev };
                  delete next[r.modelId];
                  return next;
                });
              }}
              bodyRef={(el) => {
                bodyRefs.current[r.modelId] = el;
              }}
              onScroll={onScrollColumn(r.modelId)}
            />
          ))}
        </div>
      ) : view === 'metrics' ? (
        <MetricsTable results={ordered} />
      ) : (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>模型</th>
                <th>状态</th>
                <th>首字</th>
                <th>耗时</th>
                <th>输出 Tokens</th>
                <th>总 Tokens</th>
                <th>速度</th>
                <th>成本</th>
                <th>字数</th>
                <th>评分</th>
                <th>裁判</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((r) => (
                <tr key={r.modelId}>
                  <td>
                    <div className="row" style={{ gap: 7 }}>
                      {rankMap[r.modelId] ? <span className={`rank-medal ${rankMap[r.modelId] <= 3 ? `g${rankMap[r.modelId]}` : ''}`}>{rankMap[r.modelId]}</span> : null}
                      <span className="bold">{r.modelName}</span>
                    </div>
                  </td>
                  <td>{statusBadge(r)}</td>
                  <td className="mono">{formatMs(r.metrics?.ttftMs)}</td>
                  <td className="mono">{formatMs(r.metrics?.latencyMs)}</td>
                  <td className="mono">{formatTokens(r.metrics?.completionTokens)}</td>
                  <td className="mono">{formatTokens(r.metrics?.totalTokens)}</td>
                  <td className="mono">{r.metrics?.charsPerSec ? `${formatNumber(r.metrics.charsPerSec, 1)} c/s` : '—'}</td>
                  <td className="mono">{r.metrics?.cost ? formatCost(r.metrics.cost) : '—'}</td>
                  <td className="mono">{formatNumber(r.text.length)}</td>
                  <td>{r.score ? `${r.score} ★` : '—'}</td>
                  <td>{r.judgeScore != null ? formatNumber(r.judgeScore, 1) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ordered.length > 0 && view === 'columns' ? (
        <div className="card card-pad">
          <div className="panel-title" style={{ marginBottom: 10 }}>
            回答全文（便于检索与复制）
          </div>
          <div className="col" style={{ gap: 12 }}>
            {ordered.map((r) => (
              <details key={r.modelId}>
                <summary style={{ cursor: 'pointer' }}>
                  <span className="bold small">{r.modelName}</span>{' '}
                  <span className="xsmall faint">（{formatNumber(r.text.length)} 字）</span>
                </summary>
                <div style={{ marginTop: 8 }}>
                  <textarea className="textarea mono" style={{ minHeight: 140, fontSize: 12.5 }} readOnly value={r.text} />
                </div>
              </details>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
