import { describe, expect, it } from 'vitest';
import { PRESETS, MODEL_COLORS, pickColor } from './presets';

describe('服务商预置', () => {
  it('id 唯一，便于按 id 回填表单', () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每条预置都带齐渲染所需字段', () => {
    for (const p of PRESETS) {
      expect(p.label, `${p.id} 缺 label`).toBeTruthy();
      expect(p.color, `${p.id} 缺 color`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(['openai', 'anthropic', 'gemini', 'ollama', 'mock'], `${p.id} provider 非法`).toContain(p.provider);
      expect(Array.isArray(p.models), `${p.id} models 必须是数组`).toBe(true);
    }
  });

  it('除内置模拟与自定义模板外都必须给出 Base URL', () => {
    for (const p of PRESETS) {
      if (p.provider === 'mock' || p.id === 'custom') continue;
      expect(p.baseUrl, `${p.id} 缺 baseUrl`).toMatch(/^https?:\/\//);
    }
  });

  it('预置地址以 /v1 结尾的只允许 OpenAI 兼容协议', () => {
    for (const p of PRESETS) {
      if (!p.baseUrl.endsWith('/v1') && !p.baseUrl.endsWith('/v4')) continue;
      expect(p.provider, `${p.id} 使用了 OpenAI 兼容风格地址`).toBe('openai');
    }
  });
});

describe('pickColor', () => {
  it('按序取色并循环', () => {
    expect(pickColor(0)).toBe(MODEL_COLORS[0]);
    expect(pickColor(MODEL_COLORS.length)).toBe(MODEL_COLORS[0]);
    expect(pickColor(MODEL_COLORS.length + 2)).toBe(MODEL_COLORS[2]);
  });
});
