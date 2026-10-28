import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProvider, ROUTES, routeFromHash, useApp } from './state';
import { Toaster } from './components/ui';
import { api } from './api';

vi.mock('./api', () => ({
  api: {
    bootstrap: vi.fn(),
    listModels: vi.fn(),
    listBanks: vi.fn(),
    saveSettings: vi.fn(),
  },
}));

afterEach(cleanup);

const mocked = vi.mocked(api);

afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.location.hash = '';
});

function Probe() {
  const ctx = useApp();
  return (
    <div>
      <span data-testid="route">{ctx.route}</span>
      <span data-testid="models">{ctx.models.length}</span>
      <span data-testid="banks">{ctx.banks.length}</span>
      <span data-testid="theme">{ctx.theme}</span>
      <span data-testid="enabled">{ctx.enabledModels.length}</span>
      <button onClick={() => ctx.navigate('chat')}>去对话</button>
      <button onClick={() => ctx.toggleTheme()}>切主题</button>
      <button onClick={() => ctx.pushToast('err', 'boom')}>报错</button>
    </div>
  );
}

function bootstrapOk() {
  mocked.bootstrap.mockResolvedValue({ settings: { theme: 'light' } as never, counts: {} as never } as never);
  mocked.listModels.mockResolvedValue([{ id: 'm1', name: 'A', enabled: true }, { id: 'm2', name: 'B', enabled: false }] as never);
  mocked.listBanks.mockResolvedValue([{ id: 'b1', name: '题库' }] as never);
}

function renderProbe() {
  // Toaster 负责 toast 的实际渲染，必须与 Provider 一起挂载
  return render(<AppProvider><><Probe /><Toaster /></></AppProvider>);
}

describe('AppProvider', () => {
  it('启动时拉取 bootstrap / 模型 / 题库', async () => {
    bootstrapOk();
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('models').textContent).toBe('2'));
    expect(screen.getByTestId('banks').textContent).toBe('1');
    expect(screen.getByTestId('theme').textContent).toBe('light');
    // enabled=false 的模型被过滤
    expect(screen.getByTestId('enabled').textContent).toBe('1');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('bootstrap 失败时弹出错误 toast', async () => {
    mocked.bootstrap.mockRejectedValue(new Error('网络断了'));
    renderProbe();
    expect(await screen.findByText('无法连接后端服务：网络断了')).toBeTruthy();
  });

  it('listModels 失败时 toast 并返回空列表', async () => {
    mocked.bootstrap.mockResolvedValue({ settings: {}, counts: {} } as never);
    mocked.listModels.mockRejectedValue(new Error('err'));
    renderProbe();
    expect(await screen.findByText('加载模型失败：err')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('models').textContent).toBe('0'));
  });

  it('navigate 更新路由并写入 hash', async () => {
    bootstrapOk();
    renderProbe();
    await userEvent.click(screen.getByText('去对话'));
    expect(screen.getByTestId('route').textContent).toBe('chat');
    expect(window.location.hash).toBe('#/chat');
  });

  it('hashchange 事件同步路由', async () => {
    bootstrapOk();
    renderProbe();
    window.location.hash = '#/compare';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() => expect(screen.getByTestId('route').textContent).toBe('compare'));
  });

  it('toggleTheme 更新本地设置、DOM 与远端', async () => {
    bootstrapOk();
    mocked.saveSettings.mockResolvedValue({ theme: 'dark' } as never);
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('theme').textContent).toBe('light'));
    await userEvent.click(screen.getByText('切主题'));
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(mocked.saveSettings).toHaveBeenCalledWith({ theme: 'dark' });
  });

  it('toggleTheme 在 settings 为 null 时不更新本地 settings，但远端仍写入', async () => {
    mocked.bootstrap.mockResolvedValue({ settings: null as never, counts: {} } as never);
    renderProbe();
    await userEvent.click(screen.getByText('切主题'));
    expect(mocked.saveSettings).toHaveBeenCalledWith({ theme: 'light' });
    // 本地 settings 仍为 null，主题回退默认 dark
    await waitFor(() => expect(screen.getByTestId('theme').textContent).toBe('dark'));
  });

  it('pushToast 展示错误 toast', async () => {
    bootstrapOk();
    renderProbe();
    await userEvent.click(screen.getByText('报错'));
    expect(await screen.findByText('boom')).toBeTruthy();
  });
});

describe('routeFromHash', () => {
  it('识别合法路由，未知回退 dashboard', () => {
    window.location.hash = '#/models';
    expect(routeFromHash()).toBe('models');
    window.location.hash = '#/nope?x=1';
    expect(routeFromHash()).toBe('dashboard');
    window.location.hash = '';
    expect(routeFromHash()).toBe('dashboard');
  });

  it('ROUTES 覆盖全部页面', () => {
    expect(ROUTES).toEqual(['dashboard', 'models', 'chat', 'questions', 'compare', 'runs']);
  });
});

describe('useApp 守卫', () => {
  it('在 Provider 外抛错', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useApp())).toThrow('useApp 必须在 AppProvider 内使用');
  });
});
