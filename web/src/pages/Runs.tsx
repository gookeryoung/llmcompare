import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useApp } from '../state';
import type { Run, RunSummary } from '../types';
import { PROVIDER_LABEL, downloadFile, formatCost, formatMs, formatNumber, formatTokens, formatTime, stamp, timeAgo } from '../lib/format';
import { Badge, Button, Empty, Segmented, Spinner, useConfirm } from '../components/ui';
import { MetricsTable, ResultColumn, type LiveResult } from '../components/ResultGrid';
import {
  IconColumns,
  IconDownload,
  IconHistory,
  IconPlay,
  IconRefresh,
  IconTrash,
  IconGauge,
} from '../components/Icons';

export default function RunsPage() {
  const { pushToast, setCompareDraft, navigate, settings, modelById, enabledModels } = useApp();
  const confirm = useConfirm();
  const [list, setList] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Run | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [view, setView] = useState<'columns' | 'metrics' | 'table'>('columns');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setList(await api.listRuns());
    } catch (err: any) {
      pushToast('err', err.message);
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    load();
  }, [load]);

  const open = async (id: string) => {
    setLoadingDetail(true);
    try {
      setActive(await api.getRun(id));
    } catch (err: any) {
      pushToast('err', err.message);
    } finally {
      setLoadingDetail(false);
    }
  };

  const remove = async (run: RunSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!(await confirm({ title: '删除记录', message: `确定删除「${run.title || run.question.slice(0, 20)}」吗？`, danger: true, confirmText: '删除' })))
      return;
    try {
      await api.deleteRun(run.id);
      if (active?.id === run.id) setActive(null);
      await load();
      pushToast('ok', '已删除');
    } catch (err: any) {
      pushToast('err', err.message);
    }
  };

  const rerun = (run: Run) => {
    setCompareDraft({ question: run.question, questionId: run.questionId, title: run.title, rubric: run.rubric });
    navigate('compare');
  };

  const results: LiveResult[] = useMemo(
    () =>
      (active?.results || []).map((r) => ({
        modelId: r.modelId,
        modelName: r.modelName,
        provider: r.provider,
        color: modelById(r.modelId)?.color,
        text: r.text,
        reasoning: r.reasoning,
        metrics: r.metrics,
        status: (r.status as LiveResult['status']) || 'ok',
        error: r.error,
        score: r.score ?? null,
        note: r.note,
      })),
    [active, modelById],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? list.filter((r) => `${r.title} ${r.question} ${r.modelNames.join(' ')}`.toLowerCase().includes(q)) : list;
  }, [list, query]);

  const exportActive = (format: 'md' | 'csv' | 'json') => {
    if (!active) return;
    if (format === 'json') {
      downloadFile(`评测记录-${stamp()}.json`, JSON.stringify(active, null, 2), 'application/json;charset=utf-8');
      return;
    }
    const rows = active.results || [];
    if (format === 'csv') {
      const esc = (v: any) => {
        const s = v == null ? '' : String(v);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const head = ['模型', '协议', '状态', '首字(ms)', '耗时(ms)', '输出Tokens', '总Tokens', '速度(c/s)', '成本($)', '字数', '评分', '裁判分', '备注', '回答'];
      const lines = rows.map((r) =>
        [
          r.modelName,
          r.provider ? PROVIDER_LABEL[r.provider] || r.provider : '',
          r.status,
          r.metrics?.ttftMs ?? '',
          r.metrics?.latencyMs ?? '',
          r.metrics?.completionTokens ?? '',
          r.metrics?.totalTokens ?? '',
          r.metrics?.charsPerSec ?? '',
          r.metrics?.cost ?? '',
          r.text.length,
          r.score ?? '',
          active.judge?.ranking?.find((x) => results[x.index - 1]?.modelId === r.modelId)?.score ?? '',
          r.note || '',
          r.text,
        ]
          .map(esc)
          .join(','),
      );
      downloadFile(`评测记录-${stamp()}.csv`, `\uFEFF${head.join(',')}\n${lines.join('\n')}`, 'text/csv;charset=utf-8');
      return;
    }
    const md: string[] = [`# ${active.title || '评测记录'}`, '', `- 时间：${formatTime(active.createdAt)}`, `- 问题：${active.question.replace(/\n/g, ' ')}`, ''];
    md.push('| 模型 | 状态 | 首字 | 耗时 | 输出 Tokens | 成本 | 字数 | 评分 |');
    md.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    rows.forEach((r) => {
      md.push(
        `| ${r.modelName} | ${r.status} | ${formatMs(r.metrics?.ttftMs)} | ${formatMs(r.metrics?.latencyMs)} | ${r.metrics?.completionTokens ?? '-'} | ${
          r.metrics?.cost ? formatCost(r.metrics.cost) : '-'
        } | ${r.text.length} | ${r.score ?? '-'} |`,
      );
    });
    md.push('');
    rows.forEach((r) => {
      md.push(`## ${r.modelName}`, '', r.text || '（无输出）', '');
      if (r.note) md.push(`> 备注：${r.note}`, '');
      md.push('---', '');
    });
    if (active.judge) {
      md.push('## AI 裁判', '', `- 裁判模型：${active.judge.judgeModelName}`, `- 最佳：${active.judge.best}`, '', active.judge.summary, '');
      (active.judge.ranking || []).forEach((item) => md.push(`- 回答 ${item.index}：${formatNumber(item.score, 1)} 分 —— ${item.comment}`));
    }
    downloadFile(`评测记录-${stamp()}.md`, md.join('\n'), 'text/markdown;charset=utf-8');
  };

  const judgeScoreOf = (modelId: string) => {
    if (!active?.judge?.ranking || !active.results) return undefined;
    const idx = active.results.findIndex((r) => r.modelId === modelId);
    return active.judge.ranking.find((x) => x.index === idx + 1)?.score;
  };

  const fastestTtft = useMemo(() => {
    const arr = (active?.results || [])
      .map((r) => r.metrics?.ttftMs)
      .filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
    return arr.length ? Math.min(...arr) : null;
  }, [active]);

  return (
    <div className="split">
      <aside className="chat-side">
        <div className="side-head">
          <input className="input input-sm" placeholder="搜索记录" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button size="sm" icon={<IconRefresh size={13} />} onClick={load} className="btn-block">
            刷新列表
          </Button>
        </div>
        <div className="side-scroll" style={{ padding: '0 8px 14px' }}>
          {loading ? (
            <div className="col" style={{ padding: 8 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton" style={{ height: 66 }} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty small" style={{ padding: '26px 10px' }}>
              还没有评测记录
            </div>
          ) : (
            filtered.map((r) => (
              <div key={r.id} className={`list-item ${active?.id === r.id ? 'active' : ''}`} onClick={() => open(r.id)}>
                <div className="row" style={{ gap: 7 }}>
                  <span className="small bold truncate grow" title={r.title || r.question}>
                    {r.title || r.question.slice(0, 22)}
                  </span>
                  <button className="btn btn-ghost btn-xs" onClick={(e) => remove(r, e)} title="删除">
                    <IconTrash size={12} />
                  </button>
                </div>
                <div className="xsmall faint truncate">{r.modelNames.slice(0, 3).join(' / ')}{r.modelNames.length > 3 ? ` 等 ${r.modelNames.length} 个` : ''}</div>
                <div className="row between">
                  <span className="xsmall faint">{timeAgo(r.createdAt)}</span>
                  <span className="xsmall faint">
                    {formatMs(r.avgLatency)} · {formatTokens(r.totalTokens)} tok
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      <section className="chat-main" style={{ overflow: 'auto' }}>
        {loadingDetail ? (
          <div className="row muted" style={{ padding: 20 }}>
            <Spinner /> 加载记录…
          </div>
        ) : !active ? (
          <div className="center grow">
            <Empty
              icon={<IconHistory size={22} />}
              title="选择一条评测记录"
              desc="这里保存了每次多模型对比的完整结果：每个模型的原文、耗时、Token、成本、评分与 AI 裁判结论。"
              action={
                <Button variant="primary" icon={<IconColumns size={15} />} onClick={() => navigate('compare')}>
                  去做一次对比
                </Button>
              }
            />
          </div>
        ) : (
          <div className="content" style={{ padding: '16px 18px 40px' }}>
            <div className="card card-pad col" style={{ gap: 12, marginBottom: 14 }}>
              <div className="row between wrap" style={{ gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="bold">{active.title || '未命名对比'}</span>
                    <Badge>{formatTime(active.createdAt)}</Badge>
                    <Badge kind="badge-accent">{active.results?.length || 0} 个模型</Badge>
                  </div>
                  <div className="small muted" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
                    {active.question}
                  </div>
                </div>
                <div className="row wrap" style={{ gap: 6 }}>
                  <Button size="sm" icon={<IconPlay size={13} />} onClick={() => rerun(active)}>
                    用同样的问题再跑一次
                  </Button>
                  <Segmented
                    value={view}
                    onChange={setView}
                    options={[
                      { value: 'columns', label: '并排' },
                      { value: 'metrics', label: '指标' },
                      { value: 'table', label: '表格' },
                    ]}
                  />
                  <Button size="sm" variant="ghost" icon={<IconDownload size={13} />} onClick={() => exportActive('csv')}>
                    CSV
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => exportActive('md')}>
                    MD
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => exportActive('json')}>
                    JSON
                  </Button>
                </div>
              </div>

              <div className="grid grid-4" style={{ gap: 8 }}>
                <div className="metric">
                  <span className="metric-k">平均耗时</span>
                  <span className="metric-v">
                    {formatMs(
                      (active.results || []).reduce((a, r) => a + (r.metrics?.latencyMs || 0), 0) / Math.max(1, active.results?.length || 1),
                    )}
                  </span>
                </div>
                <div className="metric">
                  <span className="metric-k">总 Tokens</span>
                  <span className="metric-v">{formatTokens((active.results || []).reduce((a, r) => a + (r.metrics?.totalTokens || 0), 0))}</span>
                </div>
                <div className="metric">
                  <span className="metric-k">总成本</span>
                  <span className="metric-v">{formatCost((active.results || []).reduce((a, r) => a + (r.metrics?.cost || 0), 0))}</span>
                </div>
                <div className="metric">
                  <span className="metric-k">最快首字</span>
                  <span className="metric-v">{formatMs(fastestTtft)}</span>
                </div>
              </div>
            </div>

            {active.judge ? (
              <div className="card card-pad col" style={{ gap: 10, marginBottom: 14 }}>
                <div className="row" style={{ gap: 8 }}>
                  <IconGauge size={15} style={{ color: 'var(--accent-hi)' }} />
                  <span className="bold">AI 裁判</span>
                  <Badge kind="badge-accent">{active.judge.judgeModelName}</Badge>
                </div>
                <div className="col" style={{ gap: 8 }}>
                  {[...(active.judge.ranking || [])]
                    .sort((a, b) => (b.score || 0) - (a.score || 0))
                    .map((item, i) => (
                      <div key={item.index} className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                        <span className={`rank-medal ${i < 3 ? `g${i + 1}` : ''}`}>{i + 1}</span>
                        <div className="grow">
                          <div className="row" style={{ gap: 8 }}>
                            <span className="small bold">{active.results?.[item.index - 1]?.modelName || `回答 ${item.index}`}</span>
                            <Badge kind="badge-accent">{formatNumber(item.score, 1)} / 10</Badge>
                          </div>
                          <div className="xsmall muted">{item.comment}</div>
                        </div>
                      </div>
                    ))}
                </div>
                {active.judge.summary ? (
                  <div className="small" style={{ borderLeft: '3px solid var(--accent)', paddingLeft: 10, color: 'var(--text-dim)' }}>
                    {active.judge.summary}
                    {active.judge.best ? (
                      <>
                        <br />
                        <span className="bold">最佳回答：{active.judge.best}</span>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {view === 'columns' ? (
              <div className="compare-grid" style={{ gridTemplateColumns: `repeat(${Math.min(results.length || 1, 3)}, minmax(0, 1fr))` }}>
                {results.map((r) => (
                  <ResultColumn
                    key={r.modelId}
                    r={{ ...r, judgeScore: judgeScoreOf(r.modelId) }}
                    rank={undefined}
                  />
                ))}
              </div>
            ) : view === 'metrics' ? (
              <MetricsTable results={results} />
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
                      <th>成本</th>
                      <th>字数</th>
                      <th>评分</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.modelId}>
                        <td className="bold">{r.modelName}</td>
                        <td>{r.status}</td>
                        <td className="mono">{formatMs(r.metrics?.ttftMs)}</td>
                        <td className="mono">{formatMs(r.metrics?.latencyMs)}</td>
                        <td className="mono">{formatTokens(r.metrics?.completionTokens)}</td>
                        <td className="mono">{r.metrics?.cost ? formatCost(r.metrics.cost) : '—'}</td>
                        <td className="mono">{formatNumber(r.text.length)}</td>
                        <td>{r.score ? `${r.score} ★` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
