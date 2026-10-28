import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JudgePanel, MetricsRow, MetricsTable, ResultColumn, statusBadge } from './ResultGrid';
import type { LiveResult } from './ResultGrid';

afterEach(cleanup);

function live(overrides: Partial<LiveResult> = {}): LiveResult {
  return {
    modelId: 'm1',
    modelName: 'ModelA',
    text: '回答内容',
    status: 'ok',
    metrics: { latencyMs: 800, ttftMs: 200, completionTokens: 40, totalTokens: 60, charsPerSec: 50, cost: 0.002, promptTokens: 20, chars: 40, finishReason: 'stop' },
    ...overrides,
  };
}

describe('statusBadge', () => {
  it('各状态映射到对应徽标文案', () => {
    const cases: Array<[LiveResult['status'], string]> = [
      ['running', '生成中'],
      ['ok', '完成'],
      ['error', '失败'],
      ['aborted', '已中止'],
      ['idle', '待运行'],
    ];
    for (const [status, label] of cases) {
      const { unmount } = render(statusBadge(live({ status })));
      expect(screen.getByText(label)).toBeTruthy();
      unmount();
    }
  });
});

describe('ResultColumn', () => {
  it('展示模型名、正文与指标', () => {
    render(<ResultColumn r={live()} />);
    expect(screen.getByTitle('ModelA')).toBeTruthy();
    expect(screen.getByText('回答内容')).toBeTruthy();
    expect(screen.getByTitle('首字延迟（TTFT）').textContent).toContain('200');
  });

  it('错误状态展示错误信息而非正文', () => {
    render(<ResultColumn r={live({ status: 'error', error: '配额不足', text: '' })} />);
    expect(screen.getByText('配额不足')).toBeTruthy();
  });

  it('rank 徽标与评分星级渲染', () => {
    render(<ResultColumn r={live({ score: 4 })} rank={2} />);
    expect(screen.getByText('2').className).toContain('rank-medal');
    expect(document.querySelectorAll('.star.on')).toHaveLength(4);
  });

  it('live 模式出现重跑/移除按钮并回调', async () => {
    const onRerun = vi.fn();
    const onRemove = vi.fn();
    render(<ResultColumn r={live()} live onRerun={onRerun} onRemove={onRemove} />);
    await userEvent.click(screen.getByTitle('重新运行该模型'));
    await userEvent.click(screen.getByTitle('移除该列'));
    expect(onRerun).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('running 时重跑按钮禁用', () => {
    render(<ResultColumn r={live({ status: 'running' })} live onRerun={() => {}} onRemove={() => {}} />);
    expect((screen.getByTitle('重新运行该模型') as HTMLButtonElement).disabled).toBe(true);
  });

  it('备注输入回调 onNote', async () => {
    const onNote = vi.fn();
    render(<ResultColumn r={live()} onNote={onNote} />);
    await userEvent.type(screen.getByPlaceholderText('备注（例如：漏掉了边界条件）'), '好');
    expect(onNote).toHaveBeenCalledWith('好');
  });

  it('有 reasoning 时展示思考过程折叠块', () => {
    render(<ResultColumn r={live({ reasoning: '先分析再作答' })} />);
    expect(screen.getByText('思考过程')).toBeTruthy();
    expect(screen.getByText('先分析再作答')).toBeTruthy();
  });
});

describe('MetricsRow', () => {
  it('running 时用 elapsedMs 兜底耗时', () => {
    render(<MetricsRow metrics={null} elapsedMs={1500} status="running" />);
    expect(screen.getByTitle('从发起请求到输出结束的总耗时').textContent).toContain('1.50 s');
  });

  it('无数据时占位符展示 —', () => {
    render(<MetricsRow metrics={null} status="idle" />);
    expect(screen.getByTitle('输出速度（字符 / 秒）').textContent).toContain('—');
    expect(screen.getByTitle('按配置的单价的预估成本').textContent).toContain('—');
  });

  it('估算 token 显示 ~ 标记', () => {
    render(<MetricsRow metrics={{ estimated: true } as never} status="ok" />);
    expect(screen.getByTitle('输出 token 数（上游未返回时按字符估算）').textContent).toContain('~');
  });
});

describe('MetricsTable', () => {
  it('为每个结果渲染 6 行指标', () => {
    render(
      <MetricsTable
        results={[live(), live({ modelId: 'm2', modelName: 'ModelB', text: '更长一点的回答内容', metrics: { latencyMs: 400 } as never })]}
      />,
    );
    expect(screen.getByText('指标横向对比')).toBeTruthy();
    expect(screen.getAllByText('ModelA')).toHaveLength(6);
    expect(screen.getAllByText('ModelB')).toHaveLength(6);
    expect(screen.getAllByText('越短越好')).toHaveLength(3);
  });

  it('零值显示占位符 —', () => {
    render(<MetricsTable results={[live({ metrics: null, text: '' })]} />);
    expect(screen.getAllByText('—')).toHaveLength(6);
  });
});

describe('JudgePanel', () => {
  it('无 judge 时返回 null', () => {
    const { container } = render(<JudgePanel judge={null} results={[]} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('展示排名、得分与最佳回答', () => {
    render(
      <JudgePanel
        judge={{ loading: false, raw: '', data: { ranking: [{ index: 2, score: 9.1, comment: '更严谨' }, { index: 1, score: 8.2, comment: '还行' }], summary: '两者接近', best: 'ModelB' } }}
        results={[live(), live({ modelId: 'm2', modelName: 'ModelB' })]}
        onClose={() => {}}
      />,
    );
    // 按分数排序：ModelB 第一
    const medals = document.querySelectorAll('.rank-medal');
    expect(medals[0].textContent).toBe('1');
    expect(medals[0].closest('.row')!.textContent).toContain('ModelB');
    expect(screen.getByText('更严谨')).toBeTruthy();
    expect(screen.getByText('两者接近')).toBeTruthy();
    expect(screen.getByText(/最佳回答：ModelB/)).toBeTruthy();
  });

  it('解析失败时展示原始输出', () => {
    render(<JudgePanel judge={{ loading: false, raw: '不是 JSON', data: null }} results={[]} onClose={() => {}} />);
    expect(screen.getByText('不是 JSON')).toBeTruthy();
  });

  it('加载中展示提示文案', () => {
    render(<JudgePanel judge={{ loading: true, raw: '', data: null }} results={[]} onClose={() => {}} />);
    expect(screen.getByText('裁判模型正在阅读各模型回答…')).toBeTruthy();
  });

  it('点击收起回调 onClose', async () => {
    const onClose = vi.fn();
    render(<JudgePanel judge={{ loading: false, raw: 'x', data: null }} results={[]} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: '收起' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('CopyButton（经 ResultColumn 集成）', () => {
  it('点击复制后短暂显示已复制', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render(<ResultColumn r={live()} />);
    await userEvent.click(screen.getByTitle('复制'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('回答内容');
  });
});
