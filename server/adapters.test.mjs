import { describe, expect, it } from 'vitest';
import { normalizeBaseUrl } from './adapters.mjs';

describe('normalizeBaseUrl', () => {
  it('自动补全协议', () => {
    expect(normalizeBaseUrl('127.0.0.1:11434', 'ollama')).toBe('http://127.0.0.1:11434');
  });

  it('OpenAI 兼容协议在裸域名后补 /v1', () => {
    expect(normalizeBaseUrl('https://api.openai.com', 'openai')).toBe('https://api.openai.com/v1');
    expect(normalizeBaseUrl('https://api.openai.com/', 'openai')).toBe('https://api.openai.com/v1');
    expect(normalizeBaseUrl('api.openai.com', 'openai')).toBe('http://api.openai.com/v1');
  });

  it('已经带路径的地址原样保留', () => {
    expect(normalizeBaseUrl('https://api.deepseek.com/v1', 'openai')).toBe('https://api.deepseek.com/v1');
    expect(normalizeBaseUrl('https://open.bigmodel.cn/api/paas/v4', 'openai')).toBe('https://open.bigmodel.cn/api/paas/v4');
  });

  it('Anthropic / Gemini 不做 /v1 推断（各自有独立路径约定）', () => {
    expect(normalizeBaseUrl('https://api.anthropic.com', 'anthropic')).toBe('https://api.anthropic.com');
    expect(normalizeBaseUrl('https://generativelanguage.googleapis.com', 'gemini')).toBe(
      'https://generativelanguage.googleapis.com',
    );
  });

  it('去掉尾部斜杠', () => {
    expect(normalizeBaseUrl('http://127.0.0.1:11434///', 'ollama')).toBe('http://127.0.0.1:11434');
  });

  it('空地址抛出可读错误', () => {
    expect(() => normalizeBaseUrl('', 'openai')).toThrow('未配置 Base URL');
    expect(() => normalizeBaseUrl('   ', 'openai')).toThrow('未配置 Base URL');
  });
});
