import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../state';
import type { Bank, Difficulty, Question } from '../types';
import { DIFFICULTY_BADGE, DIFFICULTY_LABEL, timeAgo } from '../lib/format';
import { Badge, Button, Empty, Field, Modal, Segmented, Spinner, TagsInput, useConfirm } from '../components/ui';
import {
  IconColumns,
  IconDownload,
  IconFolder,
  IconLibrary,
  IconPencil,
  IconPlus,
  IconSearch,
  IconTrash,
  IconUpload,
  IconCopy,
} from '../components/Icons';

const DIFFICULTIES: { value: '' | Difficulty; label: string }[] = [
  { value: '', label: '全部难度' },
  { value: 'easy', label: '简单' },
  { value: 'medium', label: '中等' },
  { value: 'hard', label: '困难' },
];

export default function QuestionsPage() {
  const { banks, reloadBanks, pushToast, setCompareDraft, navigate } = useApp();
  const confirm = useConfirm();
  const [bankId, setBankId] = useState('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [difficulty, setDifficulty] = useState<'' | Difficulty>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Partial<Question> | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showBank, setShowBank] = useState<Partial<Bank> | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    if (!bankId && banks.length) setBankId(banks[0].id);
  }, [banks, bankId]);

  const load = useCallback(async () => {
    if (!bankId) {
      setQuestions([]);
      return;
    }
    setLoading(true);
    try {
      setQuestions(await api.listQuestions({ bankId }));
    } catch (err: any) {
      pushToast('err', err.message);
    } finally {
      setLoading(false);
    }
  }, [bankId, pushToast]);

  useEffect(() => {
    load();
    setSelected(new Set());
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return questions.filter((item) => {
      if (difficulty && item.difficulty !== difficulty) return false;
      if (!q) return true;
      return (
        item.content.toLowerCase().includes(q) ||
        (item.title || '').toLowerCase().includes(q) ||
        (item.tags || []).some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [questions, query, difficulty]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    questions.forEach((q) => (q.tags || []).forEach((t) => s.add(t)));
    return [...s];
  }, [questions]);

  const activeBank = banks.find((b) => b.id === bankId);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((q) => q.id))));
  };

  const removeSelected = async () => {
    if (!selected.size) return;
    if (!(await confirm({ title: '批量删除', message: `确定删除选中的 ${selected.size} 道题目吗？`, danger: true, confirmText: '删除' })))
      return;
    try {
      const res = await api.bulkDeleteQuestions([...selected]);
      pushToast('ok', `已删除 ${res.removed} 道题目`);
      setSelected(new Set());
      await load();
      await reloadBanks();
    } catch (err: any) {
      pushToast('err', err.message);
    }
  };

  const removeOne = async (q: Question) => {
    if (!(await confirm({ title: '删除题目', message: '删除后无法恢复，确定继续吗？', danger: true, confirmText: '删除' }))) return;
    try {
      await api.deleteQuestion(q.id);
      await load();
      await reloadBanks();
    } catch (err: any) {
      pushToast('err', err.message);
    }
  };

  const toCompare = (items: Question[]) => {
    if (!items.length) return;
    const drafts = items.map((q) => ({ question: q.content, questionId: q.id, title: q.title, rubric: q.rubric }));
    setCompareDraft({ ...drafts[0], queue: drafts.slice(1) });
    pushToast('ok', `已载入 ${items.length} 道题目到横向对比`);
    navigate('compare');
  };

  const exportAs = (format: 'json' | 'csv' | 'md') => {
    if (!bankId) return;
    window.open(api.exportUrl(bankId, format), '_blank');
    setExportOpen(false);
  };

  const removeBank = async (bank: Bank) => {
    if (
      !(await confirm({
        title: '删除题库',
        message: `确定删除题库「${bank.name}」吗？其中的 ${bank.questionCount ?? 0} 道题目会一并删除。`,
        danger: true,
        confirmText: '删除题库',
      }))
    )
      return;
    try {
      await api.deleteBank(bank.id);
      pushToast('ok', '题库已删除');
      if (bankId === bank.id) setBankId('');
      await reloadBanks();
    } catch (err: any) {
      pushToast('err', err.message);
    }
  };

  return (
    <div className="split">
      {/* 左：题库 */}
      <aside className="chat-side">
        <div className="side-head">
          <Button variant="primary" size="sm" icon={<IconPlus size={14} />} onClick={() => setShowBank({ name: '', description: '', color: '#6366f1' })} className="btn-block">
            新建题库
          </Button>
        </div>
        <div className="side-scroll" style={{ padding: '0 8px 14px' }}>
          {banks.length === 0 ? (
            <div className="empty small" style={{ padding: '26px 10px' }}>
              还没有题库
            </div>
          ) : (
            banks.map((b) => (
              <div key={b.id} className={`list-item ${bankId === b.id ? 'active' : ''}`} onClick={() => setBankId(b.id)}>
                <div className="row" style={{ gap: 7 }}>
                  <span className="dot" style={{ background: b.color || 'var(--accent)' }} />
                  <span className="small bold truncate grow">{b.name}</span>
                  <span className="xsmall faint">{b.questionCount ?? 0}</span>
                </div>
                <div className="row between">
                  <span className="xsmall faint truncate">{b.description || '—'}</span>
                  <span className="row" style={{ gap: 0 }}>
                    <button
                      className="btn btn-ghost btn-xs"
                      title="编辑题库"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowBank(b);
                      }}
                    >
                      <IconPencil size={12} />
                    </button>
                    <button
                      className="btn btn-ghost btn-xs"
                      title="删除题库"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeBank(b);
                      }}
                    >
                      <IconTrash size={12} />
                    </button>
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* 右：题目 */}
      <section className="chat-main" style={{ background: 'transparent' }}>
        <div className="row between wrap" style={{ padding: '14px 18px 10px', gap: 10, borderBottom: '1px solid var(--border-soft)' }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <div style={{ position: 'relative' }}>
              <IconSearch size={14} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--text-faint)' }} />
              <input
                className="input input-sm"
                style={{ paddingLeft: 30, width: 220 }}
                placeholder="搜索题干 / 标签"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <select className="select input-sm" style={{ width: 120 }} value={difficulty} onChange={(e) => setDifficulty(e.target.value as any)}>
              {DIFFICULTIES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
            {allTags.length ? (
              <select
                className="select input-sm"
                style={{ width: 140 }}
                value=""
                onChange={(e) => e.target.value && setQuery(e.target.value)}
              >
                <option value="">按标签筛选…</option>
                {allTags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <div className="row" style={{ gap: 6 }}>
            {selected.size > 0 ? (
              <>
                <Button size="sm" variant="primary" icon={<IconColumns size={13} />} onClick={() => toCompare(questions.filter((q) => selected.has(q.id)))}>
                  对比选中的 {selected.size} 题
                </Button>
                <Button size="sm" variant="danger" icon={<IconTrash size={13} />} onClick={removeSelected}>
                  删除
                </Button>
              </>
            ) : null}
            <Button size="sm" icon={<IconUpload size={13} />} onClick={() => setShowImport(true)} disabled={!bankId}>
              导入
            </Button>
            <div style={{ position: 'relative' }}>
              <Button size="sm" icon={<IconDownload size={13} />} onClick={() => setExportOpen((v) => !v)} disabled={!bankId}>
                导出
              </Button>
              {exportOpen ? (
                <div className="card" style={{ position: 'absolute', right: 0, top: 36, zIndex: 5, padding: 6, width: 168 }}>
                  <button className="btn btn-ghost btn-sm btn-block" style={{ justifyContent: 'flex-start' }} onClick={() => exportAs('json')}>
                    JSON（含全部字段）
                  </button>
                  <button className="btn btn-ghost btn-sm btn-block" style={{ justifyContent: 'flex-start' }} onClick={() => exportAs('csv')}>
                    CSV（Excel 可打开）
                  </button>
                  <button className="btn btn-ghost btn-sm btn-block" style={{ justifyContent: 'flex-start' }} onClick={() => exportAs('md')}>
                    Markdown
                  </button>
                </div>
              ) : null}
            </div>
            <Button
              size="sm"
              variant="primary"
              icon={<IconPlus size={14} />}
              disabled={!bankId}
              onClick={() => setEditing({ bankId, title: '', content: '', tags: [], difficulty: 'medium', answer: '', rubric: '' })}
            >
              新增题目
            </Button>
          </div>
        </div>

        <div className="content" style={{ padding: '16px 18px 40px' }}>
          {!bankId ? (
            <div className="card">
              <Empty
                icon={<IconFolder size={22} />}
                title="请选择或创建一个题库"
                desc="题库用于按主题组织评测题目，方便后续一键发起多模型对比。"
                action={
                  <Button variant="primary" icon={<IconPlus size={15} />} onClick={() => setShowBank({ name: '', description: '', color: '#6366f1' })}>
                    新建题库
                  </Button>
                }
              />
            </div>
          ) : loading ? (
            <div className="col">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton" style={{ height: 96 }} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="card">
              <Empty
                icon={<IconLibrary size={22} />}
                title={questions.length ? '没有匹配的题目' : '该题库还是空的'}
                desc={questions.length ? '试试其他关键词或清空筛选。' : '可以手动新增，也可以从 JSON / CSV 批量导入。'}
                action={
                  <div className="row" style={{ gap: 8 }}>
                    <Button
                      variant="primary"
                      icon={<IconPlus size={15} />}
                      onClick={() => setEditing({ bankId, title: '', content: '', tags: [], difficulty: 'medium', answer: '', rubric: '' })}
                    >
                      新增题目
                    </Button>
                    <Button icon={<IconUpload size={15} />} onClick={() => setShowImport(true)}>
                      批量导入
                    </Button>
                  </div>
                }
              />
            </div>
          ) : (
            <>
              <div className="row between" style={{ marginBottom: 10 }}>
                <label className="row small muted" style={{ gap: 7, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={selected.size > 0 && selected.size === filtered.length}
                    onChange={toggleAll}
                  />
                  全选（{filtered.length} 题{activeBank ? ` · ${activeBank.name}` : ''}）
                </label>
                <span className="xsmall faint">共 {questions.length} 题</span>
              </div>
              <div className="col" style={{ gap: 10 }}>
                {filtered.map((q) => (
                  <div key={q.id} className="card card-pad card-hover" style={{ borderColor: selected.has(q.id) ? 'var(--accent)' : undefined }}>
                    <div className="row" style={{ alignItems: 'flex-start', gap: 11 }}>
                      <input type="checkbox" className="checkbox" style={{ marginTop: 3 }} checked={selected.has(q.id)} onChange={() => toggle(q.id)} />
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="row wrap" style={{ gap: 7, marginBottom: 5 }}>
                          {q.title ? <span className="bold">{q.title}</span> : null}
                          <Badge kind={DIFFICULTY_BADGE[q.difficulty] || ''}>{DIFFICULTY_LABEL[q.difficulty] || '中等'}</Badge>
                          {(q.tags || []).map((t) => (
                            <span className="tag" key={t}>
                              {t}
                            </span>
                          ))}
                          <span className="xsmall faint">{timeAgo(q.updatedAt)}</span>
                        </div>
                        <div className="small" style={{ whiteSpace: 'pre-wrap', color: 'var(--text-dim)', maxHeight: 110, overflow: 'hidden' }}>
                          {q.content}
                        </div>
                        {q.rubric ? (
                          <div className="xsmall faint" style={{ marginTop: 6 }}>
                            评分要点：{q.rubric}
                          </div>
                        ) : null}
                      </div>
                      <div className="row" style={{ gap: 2, flex: 'none' }}>
                        <Button size="xs" variant="ghost" title="带入横向对比" onClick={() => toCompare([q])}>
                          <IconColumns size={13} />
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          title="复制为新题"
                          onClick={() => setEditing({ ...q, id: undefined, title: `${q.title || '题目'} 副本` } as any)}
                        >
                          <IconCopy size={13} />
                        </Button>
                        <Button size="xs" variant="ghost" title="编辑" onClick={() => setEditing(q)}>
                          <IconPencil size={13} />
                        </Button>
                        <Button size="xs" variant="ghost" title="删除" onClick={() => removeOne(q)}>
                          <IconTrash size={13} />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {editing ? (
        <QuestionEditor
          draft={editing}
          banks={banks}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
            await reloadBanks();
          }}
        />
      ) : null}

      {showBank ? (
        <BankEditor
          draft={showBank}
          onClose={() => setShowBank(null)}
          onSaved={async (created) => {
            setShowBank(null);
            await reloadBanks();
            if (created?.id) setBankId(created.id);
          }}
        />
      ) : null}

      {showImport ? (
        <ImportModal
          bankId={bankId}
          onClose={() => setShowImport(false)}
          onDone={async () => {
            setShowImport(false);
            await load();
            await reloadBanks();
          }}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------ 题目编辑 ------------------------------ */

function QuestionEditor({
  draft,
  banks,
  onClose,
  onSaved,
}: {
  draft: Partial<Question>;
  banks: Bank[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { pushToast } = useApp();
  const isNew = !draft.id;
  const [form, setForm] = useState<Partial<Question>>({ difficulty: 'medium', tags: [], ...draft });
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Question>(k: K, v: Question[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.content?.trim()) return pushToast('err', '题干不能为空');
    if (!form.bankId) return pushToast('err', '请选择所属题库');
    setSaving(true);
    try {
      if (isNew) await api.createQuestion(form);
      else await api.updateQuestion(form.id!, form);
      pushToast('ok', isNew ? '题目已添加' : '已保存');
      onSaved();
    } catch (err: any) {
      pushToast('err', err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={isNew ? '新增题目' : '编辑题目'}
      onClose={onClose}
      size="wide"
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" loading={saving} onClick={save}>
            保存
          </Button>
        </>
      }
    >
      <div className="grid grid-2">
        <Field label="标题（可选）">
          <input className="input" value={form.title || ''} onChange={(e) => set('title', e.target.value)} placeholder="例如 逻辑推理 · 狼羊白菜" />
        </Field>
        <Field label="所属题库">
          <select className="select" value={form.bankId || ''} onChange={(e) => set('bankId', e.target.value)}>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="题干" hint="对比时会把这段内容作为 user 消息发送给每个模型。">
        <textarea className="textarea" style={{ minHeight: 140 }} value={form.content || ''} onChange={(e) => set('content', e.target.value)} />
      </Field>
      <div className="grid grid-3">
        <Field label="难度">
          <select className="select" value={form.difficulty || 'medium'} onChange={(e) => set('difficulty', e.target.value as Difficulty)}>
            <option value="easy">简单</option>
            <option value="medium">中等</option>
            <option value="hard">困难</option>
          </select>
        </Field>
        <Field label="标签">
          <TagsInput value={form.tags || []} onChange={(t) => set('tags', t)} />
        </Field>
        <Field label="题型">
          <select className="select" value={form.type || 'open'} onChange={(e) => set('type', e.target.value)}>
            <option value="open">开放问答</option>
            <option value="single">单选</option>
            <option value="multi">多选</option>
            <option value="code">代码</option>
          </select>
        </Field>
      </div>
      <Field label="参考答案（可选）">
        <textarea className="textarea" style={{ minHeight: 84 }} value={form.answer || ''} onChange={(e) => set('answer', e.target.value)} />
      </Field>
      <Field label="评分要点（可选）" hint="会在 AI 裁判评分时作为依据一并提交。">
        <textarea className="textarea" style={{ minHeight: 70 }} value={form.rubric || ''} onChange={(e) => set('rubric', e.target.value)} />
      </Field>
    </Modal>
  );
}

/* ------------------------------ 题库编辑 ------------------------------ */

function BankEditor({ draft, onClose, onSaved }: { draft: Partial<Bank>; onClose: () => void; onSaved: (b?: Bank) => void }) {
  const { pushToast } = useApp();
  const isNew = !draft.id;
  const [form, setForm] = useState<Partial<Bank>>({ color: '#6366f1', ...draft });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.name?.trim()) return pushToast('err', '题库名称不能为空');
    setSaving(true);
    try {
      const saved = isNew ? await api.createBank(form) : await api.updateBank(form.id!, form);
      pushToast('ok', isNew ? '题库已创建' : '已保存');
      onSaved(saved as Bank);
    } catch (err: any) {
      pushToast('err', err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={isNew ? '新建题库' : '编辑题库'}
      onClose={onClose}
      size="narrow"
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" loading={saving} onClick={save}>
            保存
          </Button>
        </>
      }
    >
      <Field label="名称">
        <input className="input" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如 中文写作评测集" />
      </Field>
      <Field label="描述">
        <textarea className="textarea" style={{ minHeight: 70 }} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      <Field label="标识色">
        <input className="input" type="color" value={form.color || '#6366f1'} onChange={(e) => setForm({ ...form, color: e.target.value })} />
      </Field>
    </Modal>
  );
}

/* ------------------------------- 导入 ------------------------------- */

function ImportModal({ bankId, onClose, onDone }: { bankId: string; onClose: () => void; onDone: () => void }) {
  const { pushToast } = useApp();
  const [format, setFormat] = useState<'json' | 'csv'>('json');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const sample = `[
  {
    "title": "示例题目",
    "content": "请解释什么是向量数据库。",
    "tags": ["RAG", "概念"],
    "difficulty": "medium",
    "rubric": "概念准确、有例子"
  }
]`;

  const sampleCsv = `标题,题干,标签,难度,评分要点
示例题目,请解释什么是向量数据库。,RAG|概念,medium,概念准确`;

  const pickFile = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setContent(String(reader.result || ''));
      setFormat(file.name.endsWith('.csv') ? 'csv' : 'json');
    };
    reader.readAsText(file, 'utf-8');
  };

  const doImport = async () => {
    if (!content.trim()) return pushToast('err', '请先粘贴内容或选择文件');
    setBusy(true);
    try {
      const res = await api.importQuestions(bankId, content, format);
      pushToast('ok', `成功导入 ${res.imported} 道题目`);
      onDone();
    } catch (err: any) {
      pushToast('err', `导入失败：${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="批量导入题目"
      subtitle="支持 JSON 数组（字段：title / content / tags / difficulty / answer / rubric）与 CSV。"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" loading={busy} onClick={doImport}>
            导入
          </Button>
        </>
      }
    >
      <div className="row between">
        <Segmented
          value={format}
          onChange={setFormat}
          options={[
            { value: 'json', label: 'JSON' },
            { value: 'csv', label: 'CSV' },
          ]}
        />
        <div className="row" style={{ gap: 6 }}>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.csv,.txt"
            style={{ display: 'none' }}
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
          <Button size="sm" icon={<IconUpload size={13} />} onClick={() => fileRef.current?.click()}>
            选择文件
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setContent(format === 'json' ? sample : sampleCsv)}>
            填入示例
          </Button>
        </div>
      </div>
      <Field label="内容">
        <textarea
          className="textarea mono"
          style={{ minHeight: 260, fontSize: 12.5 }}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={format === 'json' ? sample : sampleCsv}
        />
      </Field>
      {busy ? (
        <div className="row small muted">
          <Spinner /> 导入中…
        </div>
      ) : null}
    </Modal>
  );
}
