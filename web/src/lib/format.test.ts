import { describe, expect, it } from 'vitest';
import {
  DIFFICULTY_BADGE,
  DIFFICULTY_LABEL,
  PROVIDER_BADGE,
  PROVIDER_LABEL,
  copyText,
  downloadFile,
  formatCost,
  formatMs,
  formatNumber,
  formatTime,
  formatTokens,
  stamp,
  timeAgo,
  uid,
} from './format';

describe('formatMs', () => {
  it('空值返回占位符', () => {
    expect(formatMs(null)).toBe('—');
    expect(formatMs(undefined)).toBe('—');
    expect(formatMs(Number.NaN)).toBe('—');
  });

  it('毫秒级保留 ms 单位', () => {
    expect(formatMs(0)).toBe('0 ms');
    expect(formatMs(999)).toBe('999 ms');
  });

  it('秒级按数量级选择小数位', () => {
    expect(formatMs(1000)).toBe('1.00 s');
    expect(formatMs(9500)).toBe('9.50 s');
    // >= 10s 收敛到 1 位小数，避免读数过宽
    expect(formatMs(15500)).toBe('15.5 s');
  });

  it('分钟级拆成 m + s', () => {
    expect(formatMs(60000)).toBe('1m 0s');
    expect(formatMs(125000)).toBe('2m 5s');
  });
});

describe('formatNumber', () => {
  it('按千分位分组', () => {
    expect(formatNumber(1234)).toBe('1,234');
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('按指定小数位四舍五入', () => {
    expect(formatNumber(1234.567, 2)).toBe('1,234.57');
    expect(formatNumber(0.5, 1)).toBe('0.5');
  });

  it('空值返回占位符', () => {
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber(undefined)).toBe('—');
  });
});

describe('formatTokens', () => {
  it('千级以下原样输出', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
  });

  it('k / M 单位分档', () => {
    expect(formatTokens(1500)).toBe('1.5k');
    // 上万后收敛到整数 k，减少噪声
    expect(formatTokens(15000)).toBe('15k');
    expect(formatTokens(1500000)).toBe('1.50M');
  });

  it('空值按 0 处理', () => {
    expect(formatTokens(null)).toBe('0');
  });
});

describe('formatCost', () => {
  it('零成本显示 $0', () => {
    expect(formatCost(0)).toBe('$0');
    expect(formatCost(null)).toBe('$0');
  });

  it('极小值用科学计数法，避免显示成一串 0', () => {
    expect(formatCost(0.00005)).toBe('$5.0e-5');
  });

  it('小额保留 4 位、大额保留 2 位', () => {
    expect(formatCost(0.5)).toBe('$0.5000');
    expect(formatCost(12.345)).toBe('$12.35');
  });
});

describe('timeAgo', () => {
  it('空值返回空串', () => {
    expect(timeAgo()).toBe('');
    expect(timeAgo('not-a-date')).toBe('');
  });

  it('按区间给出中文相对时间', () => {
    const now = Date.now();
    expect(timeAgo(new Date(now - 10_000).toISOString())).toBe('刚刚');
    expect(timeAgo(new Date(now - 5 * 60_000).toISOString())).toBe('5 分钟前');
    expect(timeAgo(new Date(now - 2 * 3600_000).toISOString())).toBe('2 小时前');
    expect(timeAgo(new Date(now - 3 * 86400_000).toISOString())).toBe('3 天前');
  });

  it('超过一周退回绝对日期', () => {
    const iso = new Date(Date.now() - 30 * 86400_000).toISOString();
    expect(timeAgo(iso)).not.toContain('前');
    expect(timeAgo(iso)).toMatch(/\d/);
  });
});

describe('formatTime', () => {
  it('按本地时区补零输出到分钟', () => {
    const local = new Date(2026, 0, 2, 3, 4, 5);
    expect(formatTime(local.toISOString())).toBe('2026-01-02 03:04');
  });

  it('空值返回空串', () => {
    expect(formatTime()).toBe('');
  });
});

describe('uid', () => {
  it('带前缀且不重复', () => {
    const a = uid('m');
    const b = uid('m');
    expect(a.startsWith('m_')).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe('stamp', () => {
  it('形如 YYYYMMDD-HHmm，可直接拼进文件名', () => {
    expect(stamp()).toMatch(/^\d{8}-\d{4}$/);
  });
});

describe('copyText', () => {
  it('无剪贴板环境时返回 false 而不是抛错', async () => {
    await expect(copyText('hello')).resolves.toBe(false);
  });

  it('剪贴板可用时写入并返回 true', async () => {
    const written: string[] = [];
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (t: string) => {
          written.push(t);
        },
      },
    });
    try {
      await expect(copyText('hello')).resolves.toBe(true);
      expect(written).toEqual(['hello']);
    } finally {
      delete (globalThis.navigator as { clipboard?: unknown }).clipboard;
    }
  });
});

describe('downloadFile', () => {
  it('按指定 MIME 构造 Blob，并触发一次带文件名的下载', () => {
    const clicks: string[] = [];
    const appended: unknown[] = [];
    const blobs: unknown[][] = [];
    const originals = {
      Blob: (globalThis as any).Blob,
      createObjectURL: (URL as any).createObjectURL,
      revokeObjectURL: (URL as any).revokeObjectURL,
      document: (globalThis as any).document,
    };

    (globalThis as any).Blob = class {
      constructor(parts: unknown[], opts: unknown) {
        blobs.push([parts, opts]);
      }
    };
    (URL as any).createObjectURL = () => 'blob:mock';
    (URL as any).revokeObjectURL = () => {};
    (globalThis as any).document = {
      createElement: () => {
        const el: any = { style: {}, click: () => clicks.push(el.download) };
        return el;
      },
      body: { appendChild: (el: unknown) => appended.push(el), removeChild: () => {} },
    };

    try {
      downloadFile('对比结果.csv', 'a,b', 'text/csv;charset=utf-8');
      expect(blobs[0][0]).toEqual(['a,b']);
      expect(blobs[0][1]).toEqual({ type: 'text/csv;charset=utf-8' });
      expect(appended).toHaveLength(1);
      expect(clicks).toEqual(['对比结果.csv']);
    } finally {
      (globalThis as any).Blob = originals.Blob;
      (URL as any).createObjectURL = originals.createObjectURL;
      (URL as any).revokeObjectURL = originals.revokeObjectURL;
      if (originals.document === undefined) delete (globalThis as any).document;
      else (globalThis as any).document = originals.document;
    }
  });
});

describe('枚举字典', () => {
  it('难度与协议的中文标签齐全', () => {
    expect(DIFFICULTY_LABEL.easy).toBe('简单');
    expect(DIFFICULTY_LABEL.hard).toBe('困难');
    expect(DIFFICULTY_BADGE.medium).toBe('badge-warn');
    expect(PROVIDER_LABEL.anthropic).toBe('Anthropic');
    expect(PROVIDER_BADGE.mock).toBe('badge');
  });
});
