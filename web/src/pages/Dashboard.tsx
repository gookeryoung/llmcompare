import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../state';
import type { Stats } from '../types';
import { DIFFICULTY_LABEL, formatCost, formatNumber, formatTokens, timeAgo } from '../lib/format';
import { Badge, Bar, Button, Empty, Spinner } from '../components/ui';
import {
  IconChat,
  IconColumns,
  IconCpu,
  IconHistory,
  IconLibrary,
  IconPlus,
  IconSparkles,
  IconZap,
} from '../components/Icons';

export default function DashboardPage() {
  const { navigate, models, banks, pushToast } = useApp();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .stats()
      .then(setStats)
      .catch((err) => pushToast('err', err.message))
      .finally(() => setLoading(false));
  }, [pushToast]);

  if (loading || !stats) {
    return (
      <div className="row muted">
        <Spinner /> 加载概览…
      </div>
    );
  }

  const c = stats.counts;
  const tokenEntries = Object.entries(stats.tokensByModel).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxTokens = Math.max(1, ...tokenEntries.map(([, v]) => v));
  const diffTotal = Object.values(stats.byDifficulty).reduce((a, b) => a + b, 0);
  const needsSetup = models.length === 0;

  return (
    <div className="col" style={{ gap: 16 }}>
      {needsSetup ? (
        <div className="card card-pad col" style={{ gap: 12, borderColor: 'rgba(99,102,241,.4)' }}>
          <div className="row" style={{ gap: 9 }}>
            <IconSparkles size={18} style={{ color: 'var(--accent-hi)' }} />
            <span className="bold">三步开始使用</span>
          </div>
          <div className="grid grid-3">
            {[
              { n: 1, t: '接入模型', d: '支持 OpenAI 兼容、Claude、Gemini、本地 Ollama，也提供免密钥的内置模拟模型。', a: () => navigate('models'), b: '去接入' },
              { n: 2, t: '准备题目', d: '在题库中录入或批量导入题目，标注难度、标签与评分要点。', a: () => navigate('questions'), b: '去建题库' },
              { n: 3, t: '多模型对比', d: '同一个问题并行发给多个模型，对比速度、Token、成本与回答质量。', a: () => navigate('compare'), b: '去对比' },
            ].map((s) => (
              <div key={s.n} className="card card-pad col" style={{ gap: 8, background: 'var(--panel-2)' }}>
                <div className="row" style={{ gap: 8 }}>
                  <span className="rank-medal g1">{s.n}</span>
                  <span className="bold">{s.t}</span>
                </div>
                <div className="small muted" style={{ lineHeight: 1.6 }}>
                  {s.d}
                </div>
                <Button size="sm" onClick={s.a} className="btn-block">
                  {s.b}
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid grid-4">
        <button className="stat" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate('models')}>
          <span className="stat-label">已接入模型</span>
          <span className="stat-value">{c.models}</span>
          <span className="xsmall faint">其中 {c.enabledModels} 个已启用</span>
        </button>
        <button className="stat" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate('questions')}>
          <span className="stat-label">题库 / 题目</span>
          <span className="stat-value">
            {c.banks} <span className="faint" style={{ fontSize: 16 }}>/</span> {c.questions}
          </span>
          <span className="xsmall faint">按主题组织评测题目</span>
        </button>
        <button className="stat" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate('runs')}>
          <span className="stat-label">对比评测次数</span>
          <span className="stat-value">{c.runs}</span>
          <span className="xsmall faint">累计消耗 {formatTokens(stats.totalTokens)} tokens</span>
        </button>
        <button className="stat" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate('chat')}>
          <span className="stat-label">对话数 / 消息数</span>
          <span className="stat-value">
            {c.conversations} <span className="faint" style={{ fontSize: 16 }}>/</span> {c.messages}
          </span>
          <span className="xsmall faint">预估成本 {formatCost(stats.totalCost)}</span>
        </button>
      </div>

      <div className="grid grid-2">
        <div className="card card-pad col" style={{ gap: 14 }}>
          <div className="row between">
            <span className="panel-title">最近的对比评测</span>
            <Button size="xs" variant="ghost" icon={<IconHistory size={12} />} onClick={() => navigate('runs')}>
              全部记录
            </Button>
          </div>
          {stats.recentRuns.length === 0 ? (
            <Empty
              icon={<IconColumns size={20} />}
              title="还没有评测记录"
              desc="做一次多模型对比后，结果会自动出现在这里。"
              action={
                <Button size="sm" variant="primary" icon={<IconZap size={13} />} onClick={() => navigate('compare')}>
                  开始对比
                </Button>
              }
            />
          ) : (
            <div className="col" style={{ gap: 8 }}>
              {stats.recentRuns.map((r) => (
                <div key={r.id} className="list-item" style={{ background: 'var(--panel-2)' }} onClick={() => navigate('runs')}>
                  <div className="row between" style={{ gap: 10 }}>
                    <span className="small bold truncate grow">{r.title || r.question.slice(0, 30)}</span>
                    <span className="row" style={{ gap: 8, flex: 'none' }}>
                      <Badge>{r.modelCount} 模型</Badge>
                      <span className="xsmall faint nowrap">{timeAgo(r.createdAt)}</span>
                    </span>
                  </div>
                  <div className="xsmall faint truncate">{r.question}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card card-pad col" style={{ gap: 14 }}>
          <span className="panel-title">各模型 Token 消耗</span>
          {tokenEntries.length === 0 ? (
            <Empty icon={<IconCpu size={20} />} title="暂无消耗数据" desc="完成一次对比后即可看到各模型的 Token 分布。" />
          ) : (
            <div className="col" style={{ gap: 10 }}>
              {tokenEntries.map(([name, tokens]) => (
                <div key={name} className="col" style={{ gap: 5 }}>
                  <div className="row between">
                    <span className="small truncate">{name}</span>
                    <span className="mono xsmall faint">{formatTokens(tokens)}</span>
                  </div>
                  <Bar value={tokens} max={maxTokens} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid-3 grid">
        <div className="card card-pad col" style={{ gap: 12 }}>
          <span className="panel-title">题目难度分布</span>
          {diffTotal === 0 ? (
            <div className="small faint">暂无题目</div>
          ) : (
            <div className="col" style={{ gap: 10 }}>
              {(['easy', 'medium', 'hard'] as const).map((d) => (
                <div key={d} className="col" style={{ gap: 5 }}>
                  <div className="row between">
                    <span className="small">{DIFFICULTY_LABEL[d]}</span>
                    <span className="mono xsmall faint">{stats.byDifficulty[d] || 0}</span>
                  </div>
                  <Bar value={stats.byDifficulty[d] || 0} max={Math.max(1, diffTotal)} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card card-pad col" style={{ gap: 12 }}>
          <span className="panel-title">热门标签</span>
          {stats.topTags.length === 0 ? (
            <div className="small faint">暂无标签</div>
          ) : (
            <div className="row wrap" style={{ gap: 6 }}>
              {stats.topTags.map(([tag, n]) => (
                <span className="tag" key={tag}>
                  {tag} <span className="faint">{n}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="card card-pad col" style={{ gap: 12 }}>
          <span className="panel-title">快捷操作</span>
          <div className="col" style={{ gap: 8 }}>
            <Button size="sm" icon={<IconCpu size={13} />} onClick={() => navigate('models')} className="btn-block">
              接入新模型
            </Button>
            <Button size="sm" icon={<IconPlus size={13} />} onClick={() => navigate('questions')} className="btn-block">
              新建题目
            </Button>
            <Button size="sm" icon={<IconChat size={13} />} onClick={() => navigate('chat')} className="btn-block">
              开始对话
            </Button>
            <Button size="sm" variant="primary" icon={<IconColumns size={13} />} onClick={() => navigate('compare')} className="btn-block">
              多模型横向对比
            </Button>
          </div>
          <div className="divider" />
          <div className="xsmall faint" style={{ lineHeight: 1.7 }}>
            共 {banks.length} 个题库、{formatNumber(c.questions)} 道题目；全部数据保存在本机 <span className="code-inline">data/</span> 目录，不上传任何服务器。
          </div>
        </div>
      </div>

      <div className="card card-pad col" style={{ gap: 10 }}>
        <span className="panel-title">评测小贴士</span>
        <div className="grid grid-3" style={{ gap: 10 }}>
          {[
            { t: '先固定变量', d: '对比时保持 temperature、maxTokens 与系统提示一致，差异才来自模型本身。' },
            { t: '关注首字延迟', d: 'TTFT 决定交互体感，总耗时决定长文本场景的吞吐，两者要分开看。' },
            { t: '用 AI 裁判省力', d: '选一个能力较强的模型作为裁判，让它按评分要点给出排序与点评。' },
            { t: '题库沉淀', d: '把好用的题目放进题库并打标签，下次可以一键复跑，观察模型迭代效果。' },
            { t: '成本要算清', d: '在模型配置里填单价，对比表会自动估算每次调用的花费。' },
            { t: '导出留档', d: '结果可导出 CSV / Markdown / JSON，便于写评测报告或归档。' },
          ].map((x) => (
            <div key={x.t} className="col" style={{ gap: 3 }}>
              <span className="small bold">{x.t}</span>
              <span className="xsmall faint" style={{ lineHeight: 1.65 }}>
                {x.d}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <IconLibrary size={13} className="faint" />
        <span className="xsmall faint">
          数据目录：<span className="code-inline">data/</span>（models.json / banks.json / questions.json / runs.json / conversations.json）
        </span>
      </div>
    </div>
  );
}
