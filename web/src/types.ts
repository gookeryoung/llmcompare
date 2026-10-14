export type Provider = 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'mock';

export interface Pricing {
  input: number;
  output: number;
}

export interface ModelConfig {
  id: string;
  name: string;
  provider: Provider;
  baseUrl: string;
  model: string;
  enabled: boolean;
  tags: string[];
  temperature: number;
  topP: number;
  maxTokens: number;
  pricing: Pricing;
  notes?: string;
  extraHeaders?: Record<string, string>;
  authStyle?: 'x-api-key' | 'bearer' | 'both';
  mockFlavor?: 'balanced' | 'concise' | 'verbose';
  color?: string;
  lastCheck?: { at: string; latencyMs: number; ttftMs: number | null; sample: string };
  hasKey?: boolean;
  apiKeyPreview?: string;
  apiKey?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Metrics {
  latencyMs: number;
  ttftMs: number | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  chars: number;
  charsPerSec: number;
  cost: number;
  finishReason: string;
  estimated?: boolean;
  aborted?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  reasoning?: string;
  modelId?: string;
  modelName?: string;
  metrics?: Metrics;
  error?: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  modelId: string;
  systemPrompt: string;
  messages: ChatMessage[];
  params: { temperature?: number; topP?: number; maxTokens?: number };
  createdAt: string;
  updatedAt: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  modelId: string;
  messageCount: number;
  preview: string;
  createdAt: string;
  updatedAt: string;
}

export interface Bank {
  id: string;
  name: string;
  description: string;
  color: string;
  questionCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Question {
  id: string;
  bankId: string;
  title: string;
  content: string;
  type: string;
  tags: string[];
  difficulty: Difficulty;
  answer?: string;
  rubric?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunResult {
  modelId: string;
  modelName: string;
  provider?: string;
  text: string;
  reasoning?: string;
  metrics: Metrics;
  status: 'ok' | 'error' | 'aborted';
  error?: string;
  score?: number | null;
  note?: string;
}

export interface JudgeRankingItem {
  index: number;
  score: number;
  comment: string;
}

export interface Run {
  id: string;
  title: string;
  question: string;
  questionId?: string;
  rubric?: string;
  systemPrompt?: string;
  params: { temperature?: number; topP?: number; maxTokens?: number };
  results: RunResult[];
  status: string;
  judge?: {
    judgeModelId: string;
    judgeModelName: string;
    summary: string;
    best: string;
    ranking: JudgeRankingItem[];
    at: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunSummary {
  id: string;
  title: string;
  question: string;
  modelNames: string[];
  status: string;
  createdAt: string;
  avgLatency: number;
  totalTokens: number;
  totalCost: number;
}

export interface Stats {
  counts: {
    models: number;
    enabledModels: number;
    banks: number;
    questions: number;
    runs: number;
    conversations: number;
    messages: number;
  };
  tokensByModel: Record<string, number>;
  totalTokens: number;
  totalCost: number;
  timeline: { at: string; tokens: number; models: number }[];
  byDifficulty: Record<Difficulty, number>;
  topTags: [string, number][];
  recentRuns: { id: string; title: string; question: string; createdAt: string; modelCount: number }[];
}

export interface Settings {
  theme: 'dark' | 'light';
  judgeModelId: string;
  defaultParams: { temperature: number; topP: number; maxTokens: number };
  requestTimeoutMs: number;
}
