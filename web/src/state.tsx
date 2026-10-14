import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import type { Bank, ModelConfig, Settings } from './types';

export type Route = 'dashboard' | 'models' | 'chat' | 'questions' | 'compare' | 'runs';
export const ROUTES: Route[] = ['dashboard', 'models', 'chat', 'questions', 'compare', 'runs'];

export interface CompareDraft {
  question: string;
  questionId?: string;
  title?: string;
  rubric?: string;
  /** 批量对比时的题目队列（当前题目在队首之外） */
  queue?: Omit<CompareDraft, 'queue'>[];
}

export interface Toast {
  id: number;
  kind: 'ok' | 'err' | 'info';
  message: string;
}

interface AppCtx {
  route: Route;
  navigate: (r: Route) => void;
  models: ModelConfig[];
  enabledModels: ModelConfig[];
  loadingModels: boolean;
  reloadModels: () => Promise<ModelConfig[]>;
  modelById: (id: string) => ModelConfig | undefined;
  banks: Bank[];
  reloadBanks: () => Promise<void>;
  settings: Settings | null;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  toasts: Toast[];
  pushToast: (kind: Toast['kind'], message: string) => void;
  dismissToast: (id: number) => void;
  compareDraft: CompareDraft | null;
  setCompareDraft: (d: CompareDraft | null) => void;
}

const Ctx = createContext<AppCtx | null>(null);

function routeFromHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return (ROUTES as string[]).includes(raw) ? (raw as Route) : 'dashboard';
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadingModels, setLoadingModels] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [compareDraft, setCompareDraft] = useState<CompareDraft | null>(null);
  const toastId = useRef(0);

  const pushToast = useCallback((kind: Toast['kind'], message: string) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), kind === 'err' ? 7000 : 3800);
  }, []);

  const dismissToast = useCallback((id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  const reloadModels = useCallback(async () => {
    try {
      const list = await api.listModels();
      setModels(list);
      return list;
    } catch (err: any) {
      pushToast('err', `加载模型失败：${err.message}`);
      return [];
    } finally {
      setLoadingModels(false);
    }
  }, [pushToast]);

  const reloadBanks = useCallback(async () => {
    try {
      setBanks(await api.listBanks());
    } catch (err: any) {
      pushToast('err', `加载题库失败：${err.message}`);
    }
  }, [pushToast]);

  const saveSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const next = await api.saveSettings(patch);
      setSettings(next);
    },
    [],
  );

  useEffect(() => {
    (async () => {
      try {
        const boot = await api.bootstrap();
        setSettings(boot.settings);
        document.documentElement.dataset.theme = boot.settings.theme || 'dark';
        try {
          localStorage.setItem('theme', boot.settings.theme || 'dark');
        } catch {
          /* ignore */
        }
      } catch (err: any) {
        pushToast('err', `无法连接后端服务：${err.message}`);
      }
    })();
    reloadModels();
    reloadBanks();
  }, [reloadModels, reloadBanks, pushToast]);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    if (!window.location.hash) window.location.hash = '#/dashboard';
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((r: Route) => {
    window.location.hash = `#/${r}`;
    setRoute(r);
  }, []);

  const theme = settings?.theme || 'dark';

  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* ignore */
    }
    setSettings((prev) => (prev ? { ...prev, theme: next } : prev));
    api.saveSettings({ theme: next }).catch(() => undefined);
  }, [theme]);

  const modelById = useCallback((id: string) => models.find((m) => m.id === id), [models]);
  const enabledModels = useMemo(() => models.filter((m) => m.enabled !== false), [models]);

  const value: AppCtx = {
    route,
    navigate,
    models,
    enabledModels,
    loadingModels,
    reloadModels,
    modelById,
    banks,
    reloadBanks,
    settings,
    saveSettings,
    theme,
    toggleTheme,
    toasts,
    pushToast,
    dismissToast,
    compareDraft,
    setCompareDraft,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp 必须在 AppProvider 内使用');
  return ctx;
}
