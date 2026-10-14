/**
 * 轻量 JSON 持久化存储。
 * 无第三方依赖：每个集合一个 json 文件，写入使用「防抖 + 原子替换」，避免半截文件。
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const COLLECTIONS = ['models', 'conversations', 'banks', 'questions', 'runs'];

export function newId(prefix = '') {
  return (prefix ? `${prefix}_` : '') + crypto.randomBytes(8).toString('hex');
}

export function nowIso() {
  return new Date().toISOString();
}

const DEFAULT_SETTINGS = {
  theme: 'dark',
  judgeModelId: '',
  defaultParams: { temperature: 0.7, topP: 1, maxTokens: 2048 },
  requestTimeoutMs: 120000,
};

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.data = { settings: { ...DEFAULT_SETTINGS } };
    for (const c of COLLECTIONS) this.data[c] = [];
    this._timers = new Map();
    this._writing = new Map();
    this._dirty = new Set();
  }

  fileOf(name) {
    return path.join(this.dir, `${name}.json`);
  }

  async init() {
    await fsp.mkdir(this.dir, { recursive: true });
    for (const c of COLLECTIONS) {
      const raw = await this._readJson(this.fileOf(c));
      this.data[c] = Array.isArray(raw) ? raw : [];
    }
    const settings = await this._readJson(this.fileOf('settings'));
    this.data.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
    if (!settings) await this.save('settings', true);
    if (this.data.banks.length === 0 && this.data.questions.length === 0) {
      await this.seedDemo();
    }
    return this;
  }

  async _readJson(file) {
    try {
      return JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch {
      return null;
    }
  }

  // ---------- 通用 CRUD ----------
  all(collection) {
    return this.data[collection];
  }

  find(collection, id) {
    return this.data[collection].find((x) => x.id === id) || null;
  }

  insert(collection, obj) {
    const record = { id: obj.id || newId(collection.slice(0, 3)), createdAt: nowIso(), updatedAt: nowIso(), ...obj };
    this.data[collection].push(record);
    this.save(collection);
    return record;
  }

  update(collection, id, patch) {
    const record = this.find(collection, id);
    if (!record) return null;
    Object.assign(record, patch, { updatedAt: nowIso() });
    this.save(collection);
    return record;
  }

  remove(collection, id) {
    const list = this.data[collection];
    const idx = list.findIndex((x) => x.id === id);
    if (idx < 0) return false;
    list.splice(idx, 1);
    this.save(collection);
    return true;
  }

  removeWhere(collection, predicate) {
    const list = this.data[collection];
    let removed = 0;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (predicate(list[i])) {
        list.splice(i, 1);
        removed += 1;
      }
    }
    if (removed) this.save(collection);
    return removed;
  }

  get settings() {
    return this.data.settings;
  }

  setSettings(patch) {
    this.data.settings = { ...this.data.settings, ...patch };
    this.save('settings');
    return this.data.settings;
  }

  // ---------- 落盘：防抖 + 串行 + 原子替换 ----------
  save(collection, immediate = false) {
    this._dirty.add(collection);
    const pending = this._timers.get(collection);
    if (pending) clearTimeout(pending);
    if (immediate) {
      this._timers.delete(collection);
      return this._flush(collection);
    }
    this._timers.set(
      collection,
      setTimeout(() => {
        this._timers.delete(collection);
        this._flush(collection);
      }, 250),
    );
    return Promise.resolve();
  }

  _flush(collection) {
    if (!this._dirty.has(collection)) return this._writing.get(collection) || Promise.resolve();
    this._dirty.delete(collection);
    const payload = JSON.stringify(this.data[collection] ?? this.data.settings ?? {}, null, 2);
    const target = this.fileOf(collection);
    const tmp = `${target}.${process.pid}.tmp`;
    const prev = this._writing.get(collection) || Promise.resolve();
    const next = prev
      .then(async () => {
        await fsp.writeFile(tmp, payload, 'utf8');
        await fsp.rename(tmp, target);
      })
      .catch((err) => {
        console.error(`[store] 写入 ${collection} 失败:`, err.message);
      });
    this._writing.set(collection, next);
    return next;
  }

  async flushAll() {
    const jobs = [];
    for (const c of [...COLLECTIONS, 'settings']) {
      const t = this._timers.get(c);
      if (t) {
        clearTimeout(t);
        this._timers.delete(c);
      }
      jobs.push(this._flush(c));
    }
    await Promise.all(jobs);
  }

  async seedDemo() {
    const bank = this.insert('banks', {
      name: '通用能力示例题库',
      description: '内置示例，可直接编辑或删除。用于演示多模型横向对比。',
      color: '#6366f1',
    });
    const demo = [
      {
        title: '逻辑推理',
        content:
          '一个农夫要带狼、羊、白菜过河。船一次只能带一样东西，农夫不在时狼会吃羊、羊会吃白菜。请给出最少步骤的过河方案，并说明每一步的理由。',
        tags: ['推理', '经典题'],
        difficulty: 'medium',
        rubric: '方案正确（7 步）；步骤表述清晰；能说明约束条件。',
      },
      {
        title: '指令遵循',
        content: '用不超过 50 个字，向一位完全没有技术背景的 60 岁老人解释「什么是 API」。不要使用任何英文字母。',
        tags: ['指令遵循', '表达'],
        difficulty: 'easy',
        rubric: '≤50 字；无英文字母；比喻通俗准确。',
      },
      {
        title: '代码能力',
        content:
          '用 Python 写一个函数 `top_k_words(text, k)`，返回文本中出现次数最多的 k 个单词及其次数，要求：忽略大小写、忽略标点、按次数降序、次数相同时按字典序升序。只输出代码和一句话说明。',
        tags: ['代码', 'Python'],
        difficulty: 'medium',
        rubric: '可直接运行；边界条件（k<=0、空文本）处理；排序规则正确。',
      },
      {
        title: '事实与幻觉',
        content: '请列出 2024 年诺贝尔物理学奖与化学奖的获奖者及其获奖理由。如果你不确定，请明确说明不确定，不要编造。',
        tags: ['事实性', '幻觉检测'],
        difficulty: 'hard',
        rubric: '信息准确；对不确定内容明确声明；不编造人名。',
      },
      {
        title: '长文摘要',
        content: '假设你要向管理层汇报项目延期风险，请给出一个 5 句话以内的摘要模板，包含：现状、根因、影响、建议动作、需要的决策。',
        tags: ['写作', '摘要'],
        difficulty: 'easy',
        rubric: '五要素齐全；每要素一句话；语气专业克制。',
      },
      {
        title: '结构化输出',
        content: '把下面这句话转成 JSON：张三，男，1990 年 3 月出生，邮箱 zhangsan@example.com，爱好是摄影和爬山。只输出 JSON，不要解释。',
        tags: ['结构化输出', 'JSON'],
        difficulty: 'easy',
        rubric: '纯 JSON 无多余文本；字段命名合理；类型正确。',
      },
    ];
    for (const q of demo) {
      this.insert('questions', { bankId: bank.id, type: 'open', answer: '', ...q });
    }
    await this.flushAll();
    return bank;
  }
}
