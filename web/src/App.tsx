import React from 'react';
import { AppProvider, useApp, type Route } from './state';
import { Button, ConfirmProvider, Toaster } from './components/ui';
import DashboardPage from './pages/Dashboard';
import ModelsPage from './pages/Models';
import ChatPage from './pages/Chat';
import QuestionsPage from './pages/Questions';
import ComparePage from './pages/Compare';
import RunsPage from './pages/Runs';
import {
  IconChat,
  IconColumns,
  IconCpu,
  IconDashboard,
  IconHistory,
  IconLibrary,
  IconMoon,
  IconSun,
  IconZap,
} from './components/Icons';

const PAGES: Record<Route, { title: string; desc: string; flush?: boolean; render: () => React.ReactNode }> = {
  dashboard: { title: '概览', desc: '模型、题库与评测的整体情况', render: () => <DashboardPage /> },
  models: { title: '模型接入', desc: '配置服务商、密钥与默认采样参数', render: () => <ModelsPage /> },
  chat: { title: '对话', desc: '与单个模型进行多轮对话', flush: true, render: () => <ChatPage /> },
  questions: { title: '题库管理', desc: '维护评测题目、标签与难度', flush: true, render: () => <QuestionsPage /> },
  compare: { title: '横向对比', desc: '同一个问题并行发给多个模型，对比速度、成本与质量', render: () => <ComparePage /> },
  runs: { title: '评测记录', desc: '历史对比结果与 AI 裁判结论', flush: true, render: () => <RunsPage /> },
};

function Shell() {
  const { route, navigate, models, banks, theme, toggleTheme, enabledModels } = useApp();
  const page = PAGES[route];

  const nav: { key: Route; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: 'dashboard', label: '概览', icon: <IconDashboard size={17} className="nav-icon" /> },
    { key: 'models', label: '模型接入', icon: <IconCpu size={17} className="nav-icon" />, count: models.length },
    { key: 'chat', label: '对话', icon: <IconChat size={17} className="nav-icon" /> },
    { key: 'questions', label: '题库管理', icon: <IconLibrary size={17} className="nav-icon" />, count: banks.length },
    { key: 'compare', label: '横向对比', icon: <IconColumns size={17} className="nav-icon" /> },
    { key: 'runs', label: '评测记录', icon: <IconHistory size={17} className="nav-icon" /> },
  ];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">L</div>
          <div className="brand-text">
            <div className="brand-name">llmcompare</div>
            <div className="brand-sub">大模型对比分析平台</div>
          </div>
        </div>

        <div className="nav-label">工作区</div>
        {nav.map((item) => (
          <div
            key={item.key}
            className={`nav-item ${route === item.key ? 'active' : ''}`}
            onClick={() => navigate(item.key)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && navigate(item.key)}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.count != null && item.count > 0 ? <span className="nav-count">{item.count}</span> : null}
          </div>
        ))}

        <div className="sidebar-foot">
          <div className="card card-pad" style={{ padding: 11, background: 'var(--panel-2)' }}>
            <div className="row" style={{ gap: 7 }}>
              <span className="dot" style={{ background: enabledModels.length ? 'var(--ok)' : 'var(--warn)' }} />
              <span className="xsmall">
                {enabledModels.length ? `${enabledModels.length} 个模型可用` : '尚未启用模型'}
              </span>
            </div>
            {enabledModels.length === 0 ? (
              <Button size="xs" variant="primary" icon={<IconZap size={12} />} style={{ marginTop: 8 }} onClick={() => navigate('models')} className="btn-block">
                去接入
              </Button>
            ) : null}
          </div>
          <Button size="sm" variant="ghost" icon={theme === 'dark' ? <IconSun size={14} /> : <IconMoon size={14} />} onClick={toggleTheme} className="btn-block">
            {theme === 'dark' ? '切换到浅色' : '切换到深色'}
          </Button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="page-title">{page.title}</div>
            <div className="page-desc">{page.desc}</div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Button size="sm" variant="ghost" onClick={() => navigate('dashboard')} title="回到概览">
              概览
            </Button>
            <Button size="sm" variant="primary" icon={<IconCpu size={13} />} onClick={() => navigate('models')}>
              模型接入
            </Button>
          </div>
        </header>
        <div className={page.flush ? 'content flush' : 'content'}>{page.render()}</div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <ConfirmProvider>
        <Shell />
        <Toaster />
      </ConfirmProvider>
    </AppProvider>
  );
}
