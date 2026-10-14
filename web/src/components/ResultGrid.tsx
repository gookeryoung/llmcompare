import React from 'react';
import type { JudgeRankingItem, Metrics } from '../types';
import { PROVIDER_BADGE, PROVIDER_LABEL, formatCost, formatMs, formatNumber, formatTokens } from '../lib/format';
import { Badge, Bar, Button, CopyButton, Spinner, StarRating } from './ui';
import { Markdown } from './Markdown';
import { IconAlert, IconCheck, IconRefresh, IconTrash, IconZap } from './Icons';

export interface LiveResult {
  modelId: string;
  modelName: string;
  provider?: string;
  color?: string;
  text: string;
  reasoning?: string;
  metrics?: Metrics | null;
  status: 'idle' | 'running' | 'ok' | 'error' | 'aborted';
  error?: string;
  elapsedMs?: number;
  score?: number | null;
  note?: string;
  judgeScore?: number;
  judgeComment?: string;
}

export function statusBadge(r: LiveResult) {
  if (r.status === 'running')
    return (
      <Badge kind="badge-info">
        <Spinner size={10} /> 生成中
      </Badge>
    );
  if (r.status === 'ok')
    return (
      <Badge kind="badge-ok">
        <IconCheck size={11} /> 完成
      </Badge>
    );
  if (r.status === 'error')
    return (
      <Badge kind="badge-err">
        <IconAlert size={11} /> 失败
      </Badge>
    );
  if (r.status === 'aborted')
    return (
      <Badge kind="badge-warn">
        <IconAlert size={11} /> 已中止
      </Badge>
    );
  return <Badge>待运行</Badge>;
}

export function MetricsRow({ metrics, elapsedMs, status }: { metrics?: Metrics | null; elapsedMs?: number; status: string }) {
  const m = metrics;
  const latency = m?.latencyMs || (status === 'running' ? elapsedMs : 0) || 0;
  return (
    <div className="grid grid-3" style={{ gap: 6 }}>
      <div className="metric" title="首字延迟（TTFT）">
        <span className="metric-k">首字</span>
        <span className="metric-v">{formatMs(m?.ttftMs)}</span>
      </div>
      <div className="metric" title="从发起请求到输出结束的总耗时">
        <span className="metric-k">耗时</span>
        <span className="metric-v">{formatMs(latency)}</span>
      </div>
      <div className="metric" title="输出 token 数（上游未返回时按字符估算）">
        <span className="metric-k">输出 Tokens</span>
        <span className="metric-v">
          {formatTokens(m?.completionTokens)}
          {m?.estimated ? <span className="faint xsmall"> ~</span> : null}
        </span>
      </div>
      <div className="metric" title="输出速度（字符 / 秒）">
        <span className="metric-k">速度</span>
        <span className="metric-v">{m?.charsPerSec ? `${formatNumber(m.charsPerSec, 1)} c/s` : '—'}</span>
      </div>
      <div className="metric" title="输入 + 输出 token 合计">
        <span className="metric-k">总 Tokens</span>
        <span className="metric-v">{formatTokens(m?.totalTokens)}</span>
      </div>
      <div className="metric" title="按配置的单价的预估成本">
        <span className="metric-k">预估成本</span>
        <span className="metric-v">{m?.cost ? formatCost(m.cost) : '—'}</span>
      </div>
    </div>
  );
}

export function ResultColumn({
  r,
  rank,
  live,
  onScore,
  onNote,
  onRerun,
  onRemove,
  bodyRef,
  onScroll,
}: {
  r: LiveResult;
  rank?: number;
  live?: boolean;
  onScore?: (v: number | null) => void;
  onNote?: (v: string) => void;
  onRerun?: () => void;
  onRemove?: () => void;
  bodyRef?: (el: HTMLDivElement | null) => void;
  onScroll?: React.UIEventHandler<HTMLDivElement>;
}) {
  const medal = rank && rank <= 3 ? `g${rank}` : '';
  return (
    <div className="cmp-col">
      <div className="cmp-head">
        <div className="row" style={{ gap: 9 }}>
          <span
            className="avatar ai"
            style={{ background: r.color || 'linear-gradient(140deg,var(--accent),var(--accent-2))', width: 28, height: 28, borderRadius: 9, fontSize: 12 }}
          >
            {r.modelName.slice(0, 1).toUpperCase()}
          </span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 6 }}>
              <span className="bold truncate" title={r.modelName}>
                {r.modelName}
              </span>
              {rank ? <span className={`rank-medal ${medal}`}>{rank}</span> : null}
            </div>
            <div className="row" style={{ gap: 5 }}>
              {r.provider ? <Badge kind={PROVIDER_BADGE[r.provider]}>{PROVIDER_LABEL[r.provider] || r.provider}</Badge> : null}
              {statusBadge(r)}
              {r.judgeScore != null ? <Badge kind="badge-accent">裁判 {formatNumber(r.judgeScore, 1)}</Badge> : null}
            </div>
          </div>
          <div className="row" style={{ gap: 0 }}>
            {live && onRerun ? (
              <Button size="xs" variant="ghost" title="重新运行该模型" onClick={onRerun} disabled={r.status === 'running'}>
                <IconRefresh size={13} />
              </Button>
            ) : null}
            {live && onRemove ? (
              <Button size="xs" variant="ghost" title="移除该列" onClick={onRemove}>
                <IconTrash size={13} />
              </Button>
            ) : null}
          </div>
        </div>
        <MetricsRow metrics={r.metrics} elapsedMs={r.elapsedMs} status={r.status} />
      </div>

      <div className="cmp-body" ref={bodyRef} onScroll={onScroll}>
        {r.reasoning ? (
          <details className="reasoning">
            <summary style={{ cursor: 'pointer', fontSize: 12 }}>思考过程</summary>
            <div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{r.reasoning}</div>
          </details>
        ) : null}
        {r.status === 'error' ? (
          <div className="row" style={{ gap: 8, color: 'var(--err)', alignItems: 'flex-start' }}>
            <IconAlert size={15} style={{ marginTop: 2, flex: 'none' }} />
            <span className="small" style={{ wordBreak: 'break-word' }}>
              {r.error || '未知错误'}
            </span>
          </div>
        ) : r.text ? (
          r.status === 'running' ? (
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13.5, lineHeight: 1.72 }}>
              {r.text}
              <span className="caret" />
            </div>
          ) : (
            <Markdown>{r.text}</Markdown>
          )
        ) : r.status === 'running' ? (
          <span className="row small muted" style={{ gap: 8 }}>
            <Spinner size={13} /> 等待首个字符…
          </span>
        ) : (
          <span className="small faint">尚未运行</span>
        )}
      </div>

      <div className="cmp-foot">
        <span className="xsmall faint nowrap">评分</span>
        <StarRating value={r.score ?? null} onChange={onScore} />
        {r.judgeComment ? (
          <span className="xsmall faint truncate grow" title={r.judgeComment}>
            {r.judgeComment}
          </span>
        ) : (
          <span className="grow" />
        )}
        <CopyButton text={r.text} />
      </div>
      {onNote ? (
        <div style={{ padding: '0 12px 10px' }}>
          <input
            className="input input-sm"
            placeholder="备注（例如：漏掉了边界条件）"
            value={r.note || ''}
            onChange={(e) => onNote(e.target.value)}
          />
        </div>
      ) : r.note ? (
        <div style={{ padding: '0 12px 10px' }} className="xsmall faint">
          备注：{r.note}
        </div>
      ) : null}
    </div>
  );
}

export function MetricsTable({ results }: { results: LiveResult[] }) {
  const max = (pick: (r: LiveResult) => number) => Math.max(1, ...results.map((r) => pick(r) || 0));
  const maxLatency = max((r) => r.metrics?.latencyMs || 0);
  const maxTtft = max((r) => r.metrics?.ttftMs || 0);
  const maxTokens = max((r) => r.metrics?.completionTokens || 0);
  const maxCost = max((r) => r.metrics?.cost || 0);
  const maxSpeed = max((r) => r.metrics?.charsPerSec || 0);
  const maxChars = max((r) => r.text.length || 0);

  const rows: { label: string; icon?: React.ReactNode; pick: (r: LiveResult) => number; fmt: (n: number) => string; max: number; lowerBetter?: boolean }[] = [
    { label: '首字延迟', pick: (r) => r.metrics?.ttftMs || 0, fmt: (n) => formatMs(n), max: maxTtft, lowerBetter: true },
    { label: '总耗时', pick: (r) => r.metrics?.latencyMs || 0, fmt: (n) => formatMs(n), max: maxLatency, lowerBetter: true },
    { label: '输出 Tokens', pick: (r) => r.metrics?.completionTokens || 0, fmt: (n) => formatNumber(n), max: maxTokens },
    { label: '输出速度', pick: (r) => r.metrics?.charsPerSec || 0, fmt: (n) => `${formatNumber(n, 1)} c/s`, max: maxSpeed },
    { label: '输出字数', pick: (r) => r.text.length, fmt: (n) => formatNumber(n), max: maxChars },
    { label: '预估成本', pick: (r) => r.metrics?.cost || 0, fmt: (n) => formatCost(n), max: maxCost, lowerBetter: true },
  ];

  return (
    <div className="card card-pad col" style={{ gap: 16 }}>
      <div className="row between">
        <span className="panel-title">指标横向对比</span>
        <span className="xsmall faint">条形长度表示相对大小</span>
      </div>
      {rows.map((row) => (
        <div key={row.label} className="col" style={{ gap: 7 }}>
          <div className="row between">
            <span className="small bold">{row.label}</span>
            {row.lowerBetter ? <span className="xsmall faint">越短越好</span> : null}
          </div>
          {results.map((r) => (
            <div key={r.modelId} className="row" style={{ gap: 9 }}>
              <span className="small truncate" style={{ width: 132, flex: 'none' }} title={r.modelName}>
                {r.modelName}
              </span>
              <div className="grow">
                <Bar value={row.pick(r)} max={row.max} color={r.color} />
              </div>
              <span className="mono xsmall" style={{ width: 78, textAlign: 'right', flex: 'none' }}>
                {row.pick(r) ? row.fmt(row.pick(r)) : '—'}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function JudgePanel({
  judge,
  results,
  onClose,
}: {
  judge: { loading: boolean; raw: string; data: any; error?: string; modelName?: string } | null;
  results: LiveResult[];
  onClose: () => void;
}) {
  if (!judge) return null;
  const ranking: JudgeRankingItem[] = judge.data?.ranking || [];
  return (
    <div className="card card-pad col" style={{ gap: 12 }}>
      <div className="row between">
        <div className="row" style={{ gap: 8 }}>
          <IconZap size={15} style={{ color: 'var(--accent-hi)' }} />
          <span className="bold">AI 裁判结果</span>
          {judge.modelName ? <Badge kind="badge-accent">{judge.modelName}</Badge> : null}
          {judge.loading ? <Spinner size={13} /> : null}
        </div>
        <Button size="xs" variant="ghost" onClick={onClose}>
          收起
        </Button>
      </div>

      {judge.error ? (
        <div className="small" style={{ color: 'var(--err)' }}>
          {judge.error}
        </div>
      ) : null}

      {ranking.length ? (
        <div className="col" style={{ gap: 8 }}>
          {[...ranking]
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .map((item, i) => {
              const r = results[item.index - 1];
              return (
                <div key={item.index} className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                  <span className={`rank-medal ${i < 3 ? `g${i + 1}` : ''}`}>{i + 1}</span>
                  <div className="grow">
                    <div className="row" style={{ gap: 8 }}>
                      <span className="small bold">{r?.modelName || `回答 ${item.index}`}</span>
                      <Badge kind="badge-accent">{formatNumber(item.score, 1)} / 10</Badge>
                    </div>
                    <div className="xsmall muted" style={{ marginTop: 2 }}>
                      {item.comment}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      ) : judge.loading ? (
        <div className="small faint" style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
          {judge.raw || '裁判模型正在阅读各模型回答…'}
        </div>
      ) : (
        <div className="small faint" style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' }}>
          {judge.raw || '未能解析出结构化结果。'}
        </div>
      )}

      {judge.data?.summary ? (
        <div className="small" style={{ borderLeft: '3px solid var(--accent)', paddingLeft: 10, color: 'var(--text-dim)' }}>
          {judge.data.summary}
          {judge.data.best ? (
            <>
              <br />
              <span className="bold">最佳回答：{judge.data.best}</span>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
