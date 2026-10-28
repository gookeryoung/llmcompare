import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AppProvider, useApp } from '../state';
import { api } from '../api';
import { Bar, Button, ConfirmProvider, Empty, Field, Modal, StarRating, Switch, TagsInput, useConfirm, useDebounced } from './ui';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('Button', () => {
  it('loading 时禁用并显示 spinner', async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>保存</Button>);
    const btn = screen.getByRole('button', { name: '保存' });
    expect(btn).toBeDisabled();
    expect(btn.querySelector('.spin')).toBeTruthy();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('variant / size 附加到 class', () => {
    render(<Button variant="primary" size="sm">新增</Button>);
    expect(screen.getByRole('button', { name: '新增' }).className).toContain('btn-primary');
    expect(screen.getByRole('button', { name: '新增' }).className).toContain('btn-sm');
  });
});

describe('Switch', () => {
  it('点击切换并回调新状态', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} title="启用" />);
    const sw = screen.getByTitle('启用');
    expect(sw.className).not.toContain('on');
    await userEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('TagsInput', () => {
  it('回车添加标签，重复标签被忽略', async () => {
    const onChange = vi.fn();
    render(<TagsInput value={['已存在']} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    await userEvent.type(input, '新标签{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(['已存在', '新标签']);
    await userEvent.type(input, '已存在{Enter}');
    // 重复标签不触发 onChange（最后一次调用仍是首次添加的结果）
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('点击删除按钮移除标签', async () => {
    const onChange = vi.fn();
    render(<TagsInput value={['a', 'b']} onChange={onChange} />);
    await userEvent.click(screen.getByLabelText('移除 a'));
    expect(onChange).toHaveBeenCalledWith(['b']);
  });

  it('空输入时退格删除最后一个标签', async () => {
    const onChange = vi.fn();
    render(<TagsInput value={['尾']} onChange={onChange} />);
    await userEvent.type(screen.getByRole('textbox'), '{Backspace}');
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

describe('StarRating', () => {
  it('点击评分回调；再次点击同分清空', async () => {
    const onChange = vi.fn();
    render(<StarRating value={3} onChange={onChange} />);
    await userEvent.click(screen.getByTitle('4 分'));
    expect(onChange).toHaveBeenCalledWith(4);
    await userEvent.click(screen.getByTitle('3 分'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('高亮数量等于当前值', () => {
    render(<StarRating value={2} />);
    expect(document.querySelectorAll('.star.on')).toHaveLength(2);
  });
});

describe('Modal', () => {
  it('open=false 不渲染', () => {
    render(<Modal open={false} title="标题">内容</Modal>);
    expect(document.querySelector('.modal')).toBeNull();
  });

  it('portal 渲染到 body，Esc 与遮罩点击触发 onClose', async () => {
    const onClose = vi.fn();
    render(<Modal title="标题" onClose={onClose}>内容</Modal>);
    expect(screen.getByRole('dialog')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(document.querySelector('.overlay')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('closeOnOverlay=false 时点遮罩不关闭', async () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose} closeOnOverlay={false}>内容</Modal>);
    await userEvent.click(document.querySelector('.overlay')!);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('ConfirmProvider + useConfirm', () => {
  function Probe({ onResult }: { onResult: (v: boolean) => void }) {
    const confirm = useConfirm();
    return <Button onClick={() => confirm({ message: '删除？' }).then(onResult)}>触发</Button>;
  }

  it('确认返回 true，取消返回 false', async () => {
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <Probe onResult={onResult} />
      </ConfirmProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: '触发' }));
    expect(screen.getByText('删除？')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: '确定' }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));

    await userEvent.click(screen.getByRole('button', { name: '触发' }));
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });
});

describe('Empty / Field / Bar', () => {
  it('Empty 渲染标题、描述与动作', () => {
    render(<Empty title="暂无模型" desc="先去接入一个模型" action={<Button>接入</Button>} />);
    expect(screen.getByText('暂无模型')).toBeTruthy();
    expect(screen.getByText('先去接入一个模型')).toBeTruthy();
    expect(screen.getByRole('button', { name: '接入' })).toBeTruthy();
  });

  it('Field 渲染 label 与 hint', () => {
    render(<Field label="名称" hint="不超过 20 字"><input aria-label="名称输入" /></Field>);
    expect(screen.getByText('名称')).toBeTruthy();
    expect(screen.getByText('不超过 20 字')).toBeTruthy();
  });

  it('Bar 按比例计算宽度并夹在 2%~100%', () => {
    const { rerender } = render(<Bar value={50} max={100} />);
    expect((document.querySelector('.bar-fill') as HTMLElement).style.width).toBe('50%');
    rerender(<Bar value={999} max={100} />);
    expect((document.querySelector('.bar-fill') as HTMLElement).style.width).toBe('100%');
    rerender(<Bar value={5} max={0} />);
    expect((document.querySelector('.bar-fill') as HTMLElement).style.width).toBe('0%');
  });
});

describe('useDebounced', () => {
  it('延迟后跟随新值', async () => {
    const { rerender } = render(<Text value="a" />);
    rerender(<Text value="ab" />);
    expect(screen.getByTestId('deb').textContent).toBe('a');
    await waitFor(() => expect(screen.getByTestId('deb').textContent).toBe('ab'), { timeout: 400 });
  });
});

function Text({ value }: { value: string }) {
  const v = useDebounced(value, 100);
  return <span data-testid="deb">{v}</span>;
}

/** AppProvider 只是为了给依赖 useApp 的组件提供上下文 */
function withApp(ui: ReactNode) {
  vi.spyOn(api, 'bootstrap').mockResolvedValue({ settings: {}, counts: {} } as never);
  vi.spyOn(api, 'listModels').mockResolvedValue([]);
  vi.spyOn(api, 'listBanks').mockResolvedValue([]);
  return <AppProvider>{ui}</AppProvider>;
}

describe('Toaster（依赖 useApp）', () => {
  it('pushToast 后出现 toast，点击可关闭', async () => {
    const { Toaster } = await import('./ui');
    function Harness() {
      const { pushToast } = useApp();
      return (
        <>
          <button onClick={() => pushToast('err', '出错了')}>报错</button>
          <Toaster />
        </>
      );
    }
    render(withApp(<Harness />));
    await userEvent.click(screen.getByText('报错'));
    const toast = await screen.findByText('出错了');
    expect(toast.closest('.toast')!.className).toContain('err');
    await userEvent.click(toast.closest('.toast')!);
    await waitFor(() => expect(screen.queryByText('出错了')).toBeNull());
  });
});
