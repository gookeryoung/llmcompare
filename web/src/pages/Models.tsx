import { useMemo, useState } from 'react';
import { api } from '../api';
import { useApp } from '../state';
import type { ModelConfig, Provider } from '../types';
import { PROVIDER_BADGE, PROVIDER_LABEL, formatMs, timeAgo } from '../lib/format';
import { PRESETS, pickColor } from '../lib/presets';
import {
  Badge,
  Button,
  Empty,
  Field,
  Modal,
  Segmented,
  Spinner,
  Switch,
  TagsInput,
  useConfirm,
} from '../components/ui';
import {
  IconAlert,
  IconCheck,
  IconCpu,
  IconEye,
  IconEyeOff,
  IconExternal,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconCopy,
  IconZap,
} from '../components/Icons';

function emptyDraft(presetId = 'mock'): ModelConfig {
  const preset = PRESETS.find((p) => p.id === presetId) || PRESETS[0];
  return {
    id: '',
    name: preset.models[0] ? `${preset.label} · ${preset.models[0]}` : preset.label,
    provider: preset.provider,
    baseUrl: preset.baseUrl,
    model: preset.models[0] || '',
    apiKey: '',
    enabled: true,
    tags: [],
    temperature: 0.7,
    topP: 1,
    maxTokens: 2048,
    pricing: preset.pricing || { input: 0, output: 0 },
    color: preset.color,
    authStyle: 'x-api-key',
    mockFlavor: 'balanced',
    notes: '',
  };
}

export default function ModelsPage() {
  const { models, loadingModels, reloadModels, pushToast } = useApp();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<ModelConfig | null>(null);
  const [testing, setTesting] = useState<string>('');
  const [query, setQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState<'all' | Provider>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter((m) => {
      if (providerFilter !== 'all' && m.provider !== providerFilter) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.model.toLowerCase().includes(q) ||
        m.baseUrl.toLowerCase().includes(q) ||
        (m.tags || []).some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [models, query, providerFilter]);

  const runTest = async (m: ModelConfig) => {
    setTesting(m.id);
    try {
      const res = await api.testModel(m.id);
      pushToast('ok', `${m.name} 连接成功：总耗时 ${formatMs(res.latencyMs)}，首字 ${formatMs(res.ttftMs)}${res.sample ? `，返回「${res.sample.slice(0, 20)}」` : ''}`);
      await reloadModels();
    } catch (err: any) {
      pushToast('err', `${m.name} 连接失败：${err.message}`);
    } finally {
      setTesting('');
    }
  };

  const remove = async (m: ModelConfig) => {
    if (!(await confirm({ title: '删除模型', message: `确定删除「${m.name}」吗？该操作不可撤销。`, danger: true, confirmText: '删除' }))) return;
    try {
      await api.deleteModel(m.id);
      pushToast('ok', '已删除');
      await reloadModels();
    } catch (err: any) {
      pushToast('err', err.message);
    }
  };

  const duplicate = async (m: ModelConfig) => {
    const { id, apiKey, hasKey, apiKeyPreview, lastCheck, createdAt, updatedAt, ...rest } = m as any;
    setEditing({ ...emptyDraft(), ...rest, id: '', name: `${m.name} 副本`, apiKey: '' });
  };

  const quickAddMock = async () => {
    try {
      await api.createModel({
        ...emptyDraft('mock'),
        name: '内置模拟模型 A',
        model: 'mock-balanced',
        pricing: { input: 0, output: 0 },
      });
      await api.createModel({
        ...emptyDraft('mock'),
        name: '内置模拟模型 B（简洁）',
        model: 'mock-concise',
        mockFlavor: 'concise',
        color: '#22d3ee',
      });
      await api.createModel({
        ...emptyDraft('mock'),
        name: '内置模拟模型 C（详尽）',
        model: 'mock-verbose',
        mockFlavor: 'verbose',
        color: '#34d399',
      });
      pushToast('ok', '已添加 3 个内置模拟模型，可直接体验横向对比');
      await reloadModels();
    } catch (err: any) {
      pushToast('err', err.message);
    }
  };

  return (
    <>
      <div className="row between wrap" style={{ marginBottom: 14, gap: 12 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <div style={{ position: 'relative' }}>
            <IconSearch size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-faint)' }} />
            <input
              className="input input-sm"
              style={{ paddingLeft: 30, width: 230 }}
              placeholder="搜索模型 / 地址 / 标签"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Segmented
            value={providerFilter}
            onChange={setProviderFilter}
            options={[
              { value: 'all', label: '全部' },
              { value: 'openai', label: 'OpenAI 兼容' },
              { value: 'anthropic', label: 'Claude' },
              { value: 'gemini', label: 'Gemini' },
              { value: 'ollama', label: 'Ollama' },
              { value: 'mock', label: '模拟' },
            ]}
          />
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" icon={<IconRefresh size={14} />} onClick={() => reloadModels()}>
            刷新
          </Button>
          <Button size="sm" variant="primary" icon={<IconPlus size={14} />} onClick={() => setEditing(emptyDraft())}>
            接入模型
          </Button>
        </div>
      </div>

      {loadingModels ? (
        <div className="grid grid-auto">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: 168 }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <Empty
            icon={<IconCpu size={22} />}
            title={models.length === 0 ? '还没有接入任何模型' : '没有匹配的模型'}
            desc={
              models.length === 0
                ? '支持 OpenAI 兼容接口（含 DeepSeek、通义、Kimi、智谱、硅基流动、OpenRouter 等）、Anthropic Claude、Google Gemini 与本地 Ollama。也可以先用内置模拟模型体验完整流程。'
                : '换个关键词或切换筛选条件试试。'
            }
            action={
              models.length === 0 ? (
                <div className="row" style={{ gap: 8 }}>
                  <Button variant="primary" icon={<IconZap size={15} />} onClick={quickAddMock}>
                    一键添加模拟模型
                  </Button>
                  <Button icon={<IconPlus size={15} />} onClick={() => setEditing(emptyDraft())}>
                    手动接入
                  </Button>
                </div>
              ) : null
            }
          />
        </div>
      ) : (
        <div className="grid grid-auto">
          {filtered.map((m) => (
            <div key={m.id} className="card card-pad card-hover" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                <span
                  className="avatar ai"
                  style={{ background: m.color || 'linear-gradient(140deg,var(--accent),var(--accent-2))', width: 34, height: 34, borderRadius: 10, fontSize: 13 }}
                >
                  {m.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="bold truncate" title={m.name}>
                      {m.name}
                    </span>
                    {m.enabled === false ? <Badge>已停用</Badge> : null}
                  </div>
                  <div className="mono truncate faint" title={m.model}>
                    {m.model || '未设置模型 ID'}
                  </div>
                </div>
                <Switch
                  checked={m.enabled !== false}
                  title={m.enabled === false ? '启用' : '停用'}
                  onChange={async (v) => {
                    await api.updateModel(m.id, { enabled: v });
                    await reloadModels();
                  }}
                />
              </div>

              <div className="row wrap" style={{ gap: 6 }}>
                <Badge kind={PROVIDER_BADGE[m.provider]}>{PROVIDER_LABEL[m.provider] || m.provider}</Badge>
                {m.hasKey ? (
                  <Badge kind="badge-ok" title="已保存密钥">
                    <IconCheck size={11} />
                    Key
                  </Badge>
                ) : m.provider === 'mock' || m.provider === 'ollama' ? null : (
                  <Badge kind="badge-warn" title="尚未配置密钥">
                    <IconAlert size={11} />
                    缺 Key
                  </Badge>
                )}
                {(m.tags || []).slice(0, 3).map((t) => (
                  <span className="tag" key={t}>
                    {t}
                  </span>
                ))}
              </div>

              <div className="faint xsmall truncate mono" title={m.baseUrl}>
                {m.baseUrl || '（内置，无需地址）'}
              </div>

              <div className="row between" style={{ gap: 8, marginTop: 'auto' }}>
                <span className="xsmall faint">
                  {m.lastCheck
                    ? `上次连通 ${formatMs(m.lastCheck.latencyMs)} · ${timeAgo(m.lastCheck.at)}`
                    : `T=${m.temperature ?? 0.7} · max ${m.maxTokens ?? '-'}`}
                </span>
                <div className="row" style={{ gap: 2 }}>
                  <Button size="xs" variant="ghost" title="测试连接" loading={testing === m.id} onClick={() => runTest(m)}>
                    {testing === m.id ? null : <IconZap size={13} />}
                  </Button>
                  <Button size="xs" variant="ghost" title="复制配置" onClick={() => duplicate(m)}>
                    <IconCopy size={13} />
                  </Button>
                  <Button size="xs" variant="ghost" title="编辑" onClick={() => setEditing({ ...m, apiKey: '' })}>
                    <IconPencil size={13} />
                  </Button>
                  <Button size="xs" variant="ghost" title="删除" onClick={() => remove(m)}>
                    <IconTrash size={13} />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing ? (
        <ModelEditor
          draft={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reloadModels();
          }}
        />
      ) : null}
    </>
  );
}

/* ----------------------------- 编辑弹窗 ----------------------------- */

function ModelEditor({ draft, onClose, onSaved }: { draft: ModelConfig; onClose: () => void; onSaved: () => void }) {
  const { pushToast } = useApp();
  const isNew = !draft.id;
  const [form, setForm] = useState<ModelConfig>({ ...draft });
  const [apiKey, setApiKey] = useState(draft.apiKey || '');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [probed, setProbed] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [tab, setTab] = useState<'basic' | 'params' | 'advanced'>('basic');

  const set = <K extends keyof ModelConfig>(key: K, value: ModelConfig[K]) => setForm((f) => ({ ...f, [key]: value }));

  const payload = (): Partial<ModelConfig> => {
    const body: Partial<ModelConfig> = { ...form };
    delete body.hasKey;
    delete body.apiKeyPreview;
    delete body.lastCheck;
    delete body.createdAt;
    delete body.updatedAt;
    delete body.id;
    if (apiKey) body.apiKey = apiKey;
    else delete body.apiKey;
    return body;
  };

  const save = async () => {
    if (!form.name.trim()) return pushToast('err', '请填写显示名称');
    if (!form.model.trim()) return pushToast('err', '请填写模型 ID');
    if (form.provider !== 'mock' && form.provider !== 'ollama' && !form.baseUrl.trim()) {
      return pushToast('err', '请填写 Base URL');
    }
    setSaving(true);
    try {
      if (isNew) await api.createModel(payload());
      else await api.updateModel(form.id, payload());
      pushToast('ok', isNew ? '模型已接入' : '已保存');
      onSaved();
    } catch (err: any) {
      pushToast('err', err.message);
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testConfig(payload());
      setTestResult({
        ok: true,
        text: `连接成功 · 总耗时 ${formatMs(res.latencyMs)} · 首字 ${formatMs(res.ttftMs)}${res.sample ? ` · 返回：${res.sample}` : ''}`,
      });
    } catch (err: any) {
      setTestResult({ ok: false, text: `失败：${err.message}` });
    } finally {
      setTesting(false);
    }
  };

  const probe = async () => {
    setProbing(true);
    try {
      const res = await api.probeModels(payload());
      setProbed(res.models || []);
      pushToast('ok', `拉取到 ${res.models?.length || 0} 个模型`);
    } catch (err: any) {
      pushToast('err', `拉取失败：${err.message}`);
    } finally {
      setProbing(false);
    }
  };

  const applyPreset = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setForm((f) => ({
      ...f,
      provider: preset.provider,
      baseUrl: preset.baseUrl,
      model: f.model || preset.models[0] || '',
      color: preset.color,
      pricing: preset.pricing || f.pricing,
      name: f.name || (preset.models[0] ? `${preset.label} · ${preset.models[0]}` : preset.label),
      mockFlavor: preset.provider === 'mock' ? f.mockFlavor || 'balanced' : f.mockFlavor,
    }));
    setProbed(preset.models);
  };

  const activePreset = PRESETS.find((p) => p.provider === form.provider && p.baseUrl === form.baseUrl);

  return (
    <Modal
      title={isNew ? '接入新模型' : `编辑模型 · ${draft.name}`}
      subtitle="密钥仅保存在本机 data/ 目录，不会发送到浏览器以外的地方。"
      onClose={onClose}
      size="wide"
      footer={
        <>
          <div className="grow">
            {testResult ? (
              <span className={`small ${testResult.ok ? '' : ''}`} style={{ color: testResult.ok ? 'var(--ok)' : 'var(--err)' }}>
                {testResult.text}
              </span>
            ) : null}
          </div>
          <Button onClick={test} loading={testing} icon={<IconZap size={14} />}>
            测试连接
          </Button>
          <Button variant="primary" onClick={save} loading={saving}>
            {isNew ? '接入' : '保存'}
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'basic', label: '基本信息' },
            { value: 'params', label: '默认参数' },
            { value: 'advanced', label: '高级' },
          ]}
        />

        {tab === 'basic' ? (
          <>
            <Field label="服务商预置" hint="选择后会自动填入接口地址与常见模型名，仍可手动修改。">
              <div className="row wrap" style={{ gap: 6 }}>
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`btn btn-xs ${activePreset?.id === p.id ? 'btn-primary' : ''}`}
                    onClick={() => applyPreset(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </Field>

            <div className="grid grid-2">
              <Field label="显示名称">
                <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="例如 DeepSeek Chat" />
              </Field>
              <Field label="协议类型">
                <select className="select" value={form.provider} onChange={(e) => set('provider', e.target.value as Provider)}>
                  <option value="openai">OpenAI 兼容（/chat/completions）</option>
                  <option value="anthropic">Anthropic（/v1/messages）</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="ollama">Ollama 原生（/api/chat）</option>
                  <option value="mock">内置模拟（无需网络）</option>
                </select>
              </Field>
            </div>

            <Field
              label="Base URL"
              hint={
                form.provider === 'mock'
                  ? '模拟模型无需地址。'
                  : 'OpenAI 兼容请填到 /v1 为止，例如 https://api.deepseek.com/v1；Anthropic 填 https://api.anthropic.com；Gemini 填 https://generativelanguage.googleapis.com。'
              }
            >
              <input
                className="input mono"
                value={form.baseUrl}
                disabled={form.provider === 'mock'}
                onChange={(e) => set('baseUrl', e.target.value)}
                placeholder="https://api.example.com/v1"
              />
            </Field>

            <Field
              label="API Key"
              hint={!isNew && draft.hasKey ? `已保存：${draft.apiKeyPreview}。留空表示不修改。` : '本地部署（Ollama / LM Studio）可留空。'}
            >
              <div className="row" style={{ gap: 8 }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input
                    className="input mono"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={!isNew && draft.hasKey ? '••••••••（留空不修改）' : 'sk-...'}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    style={{ position: 'absolute', right: 4, top: 4 }}
                    onClick={() => setShowKey((v) => !v)}
                    title={showKey ? '隐藏' : '显示'}
                  >
                    {showKey ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                  </button>
                </div>
                {activePreset?.keyUrl ? (
                  <a className="btn btn-sm" href={activePreset.keyUrl} target="_blank" rel="noreferrer">
                    <IconExternal size={13} />
                    获取 Key
                  </a>
                ) : null}
              </div>
            </Field>

            <Field label="模型 ID" hint="上游真实模型名，例如 gpt-4o / deepseek-chat / claude-sonnet-4-5 / gemini-2.5-pro。">
              <div className="row" style={{ gap: 8 }}>
                <input
                  className="input mono"
                  list="probed-models"
                  value={form.model}
                  onChange={(e) => set('model', e.target.value)}
                  placeholder="gpt-4o-mini"
                />
                <datalist id="probed-models">
                  {probed.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                <Button onClick={probe} loading={probing} title="从上游拉取可用模型列表">
                  {probing ? null : <IconRefresh size={14} />}
                  拉取列表
                </Button>
              </div>
            </Field>

            <div className="grid grid-2">
              <Field label="标签" hint="用于筛选与分组，例如「推理」「便宜」「长文本」。">
                <TagsInput value={form.tags || []} onChange={(t) => set('tags', t)} />
              </Field>
              <Field label="备注">
                <input className="input" value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} placeholder="可选" />
              </Field>
            </div>
          </>
        ) : null}

        {tab === 'params' ? (
          <>
            <Field
              label={`默认 Temperature：${form.temperature ?? 0.7}`}
              hint="作为新对话 / 新对比任务的初始值，之后仍可在使用页面单独调整。"
            >
              <input
                className="range"
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={form.temperature ?? 0.7}
                onChange={(e) => set('temperature', Number(e.target.value))}
              />
            </Field>
            <div className="grid grid-3">
              <Field label="Top P">
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={form.topP ?? 1}
                  onChange={(e) => set('topP', Number(e.target.value))}
                />
              </Field>
              <Field label="最大输出 Tokens">
                <input
                  className="input"
                  type="number"
                  min={1}
                  step={64}
                  value={form.maxTokens ?? 2048}
                  onChange={(e) => set('maxTokens', Number(e.target.value))}
                />
              </Field>
              <Field label="标识色">
                <input className="input" type="color" value={form.color || pickColor(0)} onChange={(e) => set('color', e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-2">
              <Field label="输入价格（$ / 百万 tokens）" hint="留 0 则不统计成本。">
                <input
                  className="input"
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.pricing?.input ?? 0}
                  onChange={(e) => set('pricing', { ...(form.pricing || { input: 0, output: 0 }), input: Number(e.target.value) })}
                />
              </Field>
              <Field label="输出价格（$ / 百万 tokens）">
                <input
                  className="input"
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.pricing?.output ?? 0}
                  onChange={(e) => set('pricing', { ...(form.pricing || { input: 0, output: 0 }), output: Number(e.target.value) })}
                />
              </Field>
            </div>
            {form.provider === 'mock' ? (
              <Field label="模拟风格" hint="用于让几个模拟模型的输出产生差异，便于观察对比效果。">
                <select className="select" value={form.mockFlavor || 'balanced'} onChange={(e) => set('mockFlavor', e.target.value as any)}>
                  <option value="balanced">均衡（默认速度）</option>
                  <option value="concise">简洁（快、短）</option>
                  <option value="verbose">详尽（慢、长）</option>
                </select>
              </Field>
            ) : null}
          </>
        ) : null}

        {tab === 'advanced' ? (
          <>
            {form.provider === 'anthropic' ? (
              <Field label="鉴权方式" hint="官方 API 用 x-api-key；部分第三方网关只认 Bearer。">
                <select className="select" value={form.authStyle || 'x-api-key'} onChange={(e) => set('authStyle', e.target.value as any)}>
                  <option value="x-api-key">x-api-key（官方）</option>
                  <option value="bearer">Authorization: Bearer</option>
                  <option value="both">两者都发送</option>
                </select>
              </Field>
            ) : null}
            <Field label="自定义请求头（JSON）" hint='例如 {"HTTP-Referer":"https://your.site"}，OpenRouter 等网关有时需要。'>
              <textarea
                className="textarea mono"
                style={{ minHeight: 90 }}
                value={form.extraHeaders ? JSON.stringify(form.extraHeaders, null, 2) : ''}
                placeholder="{}"
                onChange={(e) => {
                  const raw = e.target.value;
                  if (!raw.trim()) return set('extraHeaders', undefined);
                  try {
                    set('extraHeaders', JSON.parse(raw));
                  } catch {
                    /* 输入过程中允许非法 JSON */
                  }
                }}
              />
            </Field>
            <Field label="启用状态">
              <div className="row">
                <Switch checked={form.enabled !== false} onChange={(v) => set('enabled', v)} />
                <span className="small muted">{form.enabled !== false ? '参与对话与对比' : '已停用，不会出现在可选列表'}</span>
              </div>
            </Field>
            {testing ? (
              <div className="row small muted">
                <Spinner /> 正在测试…
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}
