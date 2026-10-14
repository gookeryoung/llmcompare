import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../state';
import { copyText } from '../lib/format';
import {
  IconAlert,
  IconCheck,
  IconCopy,
  IconX,
  IconStar,
  IconPlus,
  IconSparkles,
} from './Icons';

/* ------------------------------- 基础件 ------------------------------- */

export function Spinner({ size = 15 }: { size?: number }) {
  return <span className="spin" style={{ width: size, height: size }} />;
}

type BtnVariant = 'default' | 'primary' | 'ghost' | 'danger';

export function Button({
  variant = 'default',
  size,
  loading,
  icon,
  children,
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant;
  size?: 'sm' | 'xs';
  loading?: boolean;
  icon?: React.ReactNode;
}) {
  const cls = [
    'btn',
    variant === 'primary' ? 'btn-primary' : '',
    variant === 'ghost' ? 'btn-ghost' : '',
    variant === 'danger' ? 'btn-danger' : '',
    size ? `btn-${size}` : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={cls} disabled={rest.disabled || loading} {...rest}>
      {loading ? <Spinner size={size === 'xs' ? 11 : 13} /> : icon}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
  right,
  style,
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
  right?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className="field" style={style}>
      {(label || right) && (
        <div className="row between">
          {label ? <label className="label">{label}</label> : <span />}
          {right}
        </div>
      )}
      {children}
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function Switch({ checked, onChange, title }: { checked: boolean; onChange: (v: boolean) => void; title?: string }) {
  return <button type="button" title={title} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} />;
}

export function Badge({ kind = '', children, title }: { kind?: string; children: React.ReactNode; title?: string }) {
  return (
    <span className={`badge ${kind}`} title={title}>
      {children}
    </span>
  );
}

export function Empty({
  icon,
  title,
  desc,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  desc?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      {icon ? <div className="empty-icon">{icon}</div> : null}
      <div className="empty-title">{title}</div>
      {desc ? <div className="small" style={{ maxWidth: 420 }}>{desc}</div> : null}
      {action ? <div style={{ marginTop: 6 }}>{action}</div> : null}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="row" style={{ gap: 3, padding: 3, background: 'var(--panel-2)', borderRadius: 9, border: '1px solid var(--border-soft)' }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`btn btn-xs ${value === o.value ? 'btn-primary' : 'btn-ghost'}`}
          style={{ border: 'none' }}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------- 弹层 -------------------------------- */

export function Modal({
  open = true,
  title,
  subtitle,
  onClose,
  children,
  footer,
  size,
  closeOnOverlay = true,
}: {
  open?: boolean;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose?: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'narrow' | 'wide';
  closeOnOverlay?: boolean;
}) {
  useEffect(() => {
    if (!open || !onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (closeOnOverlay && e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className={`modal ${size || ''}`} role="dialog" aria-modal="true">
        {title ? (
          <div className="modal-head">
            <div className="grow">
              <div className="modal-title">{title}</div>
              {subtitle ? <div className="hint">{subtitle}</div> : null}
            </div>
            {onClose ? (
              <Button variant="ghost" size="sm" onClick={onClose} aria-label="关闭">
                <IconX size={15} />
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({
  title,
  onClose,
  children,
  footer,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="overlay" style={{ justifyContent: 'flex-end', padding: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog">
        <div className="modal-head">
          <div className="modal-title grow">{title}</div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <IconX size={15} />
          </Button>
        </div>
        <div className="modal-body grow" style={{ flex: 1 }}>
          {children}
        </div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------ 确认对话 ------------------------------ */

interface ConfirmOptions {
  title?: string;
  message: React.ReactNode;
  confirmText?: string;
  danger?: boolean;
}

const ConfirmCtx = createContext<(opts: ConfirmOptions) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...opts, resolve })),
    [],
  );
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Modal
        open={Boolean(state)}
        title={state?.title || '请确认'}
        onClose={() => close(false)}
        size="narrow"
        footer={
          <>
            <Button onClick={() => close(false)}>取消</Button>
            <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
              {state?.confirmText || '确定'}
            </Button>
          </>
        }
      >
        <div className="row" style={{ alignItems: 'flex-start', gap: 11 }}>
          {state?.danger ? <IconAlert size={20} style={{ color: 'var(--warn)', flex: 'none', marginTop: 1 }} /> : null}
          <div style={{ lineHeight: 1.65 }}>{state?.message}</div>
        </div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmCtx);

/* ------------------------------ 小组件 ------------------------------ */

export function TagsInput({
  value,
  onChange,
  placeholder = '输入后回车添加',
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const t = draft.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft('');
  };
  return (
    <div className="tags-input">
      {value.map((t) => (
        <span className="tag" key={t}>
          {t}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`移除 ${t}`}>
            <IconX size={11} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Backspace' && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}

export function StarRating({
  value,
  onChange,
  max = 5,
  size = 15,
}: {
  value?: number | null;
  onChange?: (v: number | null) => void;
  max?: number;
  size?: number;
}) {
  const [hover, setHover] = useState(0);
  const shown = hover || value || 0;
  return (
    <span className="stars" onMouseLeave={() => setHover(0)}>
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          className={`star ${n <= shown ? 'on' : ''}`}
          title={`${n} 分`}
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange?.(value === n ? null : n)}
        >
          <IconStar size={size} style={{ fill: n <= shown ? 'currentColor' : 'transparent' }} />
        </button>
      ))}
    </span>
  );
}

export function CopyButton({ text, label, size = 'xs' }: { text: string; label?: string; size?: 'xs' | 'sm' }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size={size}
      variant="ghost"
      title="复制"
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        }
      }}
    >
      {done ? <IconCheck size={13} /> : <IconCopy size={13} />}
      {label ? (done ? '已复制' : label) : null}
    </Button>
  );
}

export function Metric({ k, v, title }: { k: string; v: React.ReactNode; title?: string }) {
  return (
    <div className="metric" title={title}>
      <span className="metric-k">{k}</span>
      <span className="metric-v">{v}</span>
    </div>
  );
}

export function Bar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="bar-track">
      <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function Toaster() {
  const { toasts, dismissToast } = useApp();
  if (!toasts.length) return null;
  return createPortal(
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'ok' ? 'ok' : t.kind === 'err' ? 'err' : ''}`} onClick={() => dismissToast(t.id)}>
          <span style={{ flex: 'none', marginTop: 1, color: t.kind === 'err' ? 'var(--err)' : t.kind === 'ok' ? 'var(--ok)' : 'var(--info)' }}>
            {t.kind === 'err' ? <IconAlert size={15} /> : t.kind === 'ok' ? <IconCheck size={15} /> : <IconSparkles size={15} />}
          </span>
          <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{t.message}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function AddButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button variant="primary" size="sm" icon={<IconPlus size={14} />} onClick={onClick}>
      {children}
    </Button>
  );
}

export function useDebounced<T>(value: T, delay = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export function AutoTextarea({
  value,
  onChange,
  onSubmit,
  placeholder,
  minRows = 1,
  maxHeight = 220,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  minRows?: number;
  maxHeight?: number;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [maxHeight]);
  useEffect(resize, [value, resize]);
  return (
    <textarea
      ref={ref}
      rows={minRows}
      disabled={disabled}
      value={value}
      placeholder={placeholder}
      onChange={(e) => {
        onChange(e.target.value);
        resize();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || (!e.shiftKey && onSubmit))) {
          if (onSubmit && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }
      }}
      style={{ maxHeight }}
    />
  );
}

export function useMemoizedList<T>(items: T[], keyFn: (item: T) => string) {
  return useMemo(() => items.map((i) => ({ key: keyFn(i), item: i })), [items, keyFn]);
}
