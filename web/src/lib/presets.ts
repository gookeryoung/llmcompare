import type { Provider } from '../types';

export interface ProviderPreset {
  id: string;
  label: string;
  provider: Provider;
  baseUrl: string;
  models: string[];
  keyUrl?: string;
  note?: string;
  pricing?: { input: number; output: number };
  color: string;
}

/**
 * 常见服务商预置。价格仅为「每百万 token / 美元」的参考值，可随时在表单中修改；
 * 若不需要成本统计，把价格留 0 即可。
 */
export const PRESETS: ProviderPreset[] = [
  {
    id: 'mock',
    label: '内置模拟模型',
    provider: 'mock',
    baseUrl: '',
    models: ['mock-balanced', 'mock-concise', 'mock-verbose'],
    note: '无需任何密钥，用于先跑通流程、演示横向对比。',
    color: '#64748b',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini'],
    keyUrl: 'https://platform.openai.com/api-keys',
    pricing: { input: 2.5, output: 10 },
    color: '#10a37f',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek 深度求索',
    provider: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
    pricing: { input: 0.27, output: 1.1 },
    color: '#4d6bfe',
  },
  {
    id: 'qwen',
    label: '阿里云百炼 / 通义千问',
    provider: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen3-235b-a22b'],
    keyUrl: 'https://bailian.console.aliyun.com/',
    color: '#615ced',
  },
  {
    id: 'moonshot',
    label: 'Moonshot / Kimi',
    provider: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2-0905-preview', 'moonshot-v1-8k', 'moonshot-v1-32k'],
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    color: '#1f2937',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    provider: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash'],
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    color: '#3859ff',
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    provider: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct', 'meta-llama/Llama-3.3-70B-Instruct'],
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    color: '#7c3aed',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    provider: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['openai/gpt-4o', 'anthropic/claude-sonnet-4', 'google/gemini-2.5-pro', 'deepseek/deepseek-chat'],
    keyUrl: 'https://openrouter.ai/keys',
    note: '一个 Key 即可调用上百个模型，做横向对比非常方便。',
    color: '#8b5cf6',
  },
  {
    id: 'groq',
    label: 'Groq',
    provider: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    keyUrl: 'https://console.groq.com/keys',
    color: '#f55036',
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    provider: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-2-latest', 'grok-beta'],
    keyUrl: 'https://console.x.ai/',
    color: '#111827',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
    keyUrl: 'https://console.anthropic.com/settings/keys',
    pricing: { input: 3, output: 15 },
    color: '#d97757',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    provider: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    keyUrl: 'https://aistudio.google.com/app/apikey',
    color: '#4285f4',
  },
  {
    id: 'ollama',
    label: 'Ollama 本地',
    provider: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    models: ['qwen2.5:7b', 'llama3.1:8b', 'deepseek-r1:7b'],
    keyUrl: 'https://ollama.com/download',
    note: '本地部署，无需 Key。确保已执行 ollama serve。',
    color: '#0f172a',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio / vLLM / 本地网关',
    provider: 'openai',
    baseUrl: 'http://127.0.0.1:1234/v1',
    models: ['local-model'],
    note: '任何 OpenAI 兼容的本地推理服务都可以直接填地址。',
    color: '#0ea5e9',
  },
  {
    id: 'custom',
    label: '自定义（OpenAI 兼容）',
    provider: 'openai',
    baseUrl: '',
    models: [],
    note: '适用于 one-api / new-api / FastGPT 等自建网关。',
    color: '#475569',
  },
];

export const MODEL_COLORS = [
  '#6366f1',
  '#22d3ee',
  '#34d399',
  '#fbbf24',
  '#f87171',
  '#a78bfa',
  '#f472b6',
  '#38bdf8',
  '#facc15',
  '#4ade80',
];

export function pickColor(index: number): string {
  return MODEL_COLORS[index % MODEL_COLORS.length];
}
