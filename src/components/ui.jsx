// Small shared UI primitives.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Info, Loader2, X } from 'lucide-react';
import { cn } from '../lib/format.js';

export function Spinner({ size = 14, className }) {
  return <Loader2 size={size} className={cn('animate-spin', className)} />;
}

export function Button({ variant = 'default', size, icon: Icon, loading, children, className, ...props }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={cn('btn', variant === 'primary' && 'btn-primary', variant === 'ghost' && 'btn-ghost', variant === 'danger' && 'btn-danger', size === 'sm' && 'btn-sm', className)}
    >
      {loading ? <Spinner size={size === 'sm' ? 12 : 14} /> : Icon ? <Icon size={size === 'sm' ? 13 : 15} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon: Icon, label, active, size = 16, className, ...props }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      {...props}
      className={cn('inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface2 hover:text-ink disabled:opacity-40', active && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent', className)}
    >
      <Icon size={size} />
    </button>
  );
}

export function Modal({ open, onClose, title, children, footer, width = 'max-w-lg' }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cn('card anim-pop flex max-h-full w-full flex-col shadow-xl', width)}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, className }) {
  return (
    <label className={cn('block', className)}>
      {label && <span className="label">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Empty({ icon: Icon, title, text, children }) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center px-8 py-10 text-center">
      {Icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface2 text-muted">
          <Icon size={20} />
        </div>
      )}
      <div className="text-[15px] font-semibold">{title}</div>
      {text && <p className="mt-1 max-w-sm text-[13px] text-muted">{text}</p>}
      {children && <div className="mt-4 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

export function Segmented({ value, onChange, options, className }) {
  return (
    <div className={cn('inline-flex rounded-md border border-line bg-surface2 p-0.5', className)}>
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} className={cn('rounded px-2.5 py-1 text-xs font-medium transition-colors', value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-[13px] font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={cn('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line')}>
        <span className={cn('absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', checked && 'translate-x-4')} />
      </button>
    </label>
  );
}

export function Progress({ value, className }) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface2', className)}>
      <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.round(Math.min(1, Math.max(0, value || 0)) * 100)}%` }} />
    </div>
  );
}

/** Click-to-open dropdown menu. items: [{label, icon, onClick, danger, disabled} | 'sep'] */
export function Menu({ trigger, items, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => !ref.current?.contains(e.target) && setOpen(false);
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <span onClick={() => setOpen((o) => !o)}>{trigger}</span>
      {open && (
        <div className={cn('card anim-pop absolute z-40 mt-1 min-w-48 py-1 shadow-lg', align === 'right' ? 'right-0' : 'left-0')}>
          {items.filter(Boolean).map((it, i) =>
            it === 'sep' ? (
              <div key={i} className="my-1 border-t border-line" />
            ) : (
              <button
                key={i}
                type="button"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onClick?.();
                }}
                className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-surface2 disabled:opacity-40', it.danger && 'text-danger')}
              >
                {it.icon && <it.icon size={14} className="shrink-0" />}
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function Banner({ tone = 'info', children, action }) {
  const tones = { info: 'bg-accent-soft text-ink', warn: 'bg-warn-soft text-ink', danger: 'bg-danger-soft text-ink' };
  const Icon = tone === 'info' ? Info : AlertTriangle;
  return (
    <div className={cn('flex items-start gap-2.5 rounded-md px-3 py-2.5 text-[13px]', tones[tone])}>
      <Icon size={15} className={cn('mt-0.5 shrink-0', tone === 'info' ? 'text-accent' : tone === 'warn' ? 'text-warn' : 'text-danger')} />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

// ---------- toasts ----------
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const toast = useCallback((message, type = 'info') => {
    const id = Math.random();
    setItems((x) => [...x.slice(-3), { id, message, type }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), type === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex w-96 max-w-[90vw] -translate-x-1/2 flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} role="status" className="card anim-fade pointer-events-auto flex items-start gap-2 px-3 py-2.5 text-[13px] shadow-lg">
            {t.type === 'error' ? <AlertTriangle size={15} className="mt-0.5 shrink-0 text-danger" /> : t.type === 'success' ? <Check size={15} className="mt-0.5 shrink-0 text-accent" /> : <Info size={15} className="mt-0.5 shrink-0 text-muted" />}
            <span className="min-w-0 flex-1 break-words">{t.message}</span>
            <button type="button" aria-label="Dismiss" className="text-muted hover:text-ink" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))}>
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- confirm / prompt dialogs ----------
const DialogCtx = createContext(null);
export const useDialogs = () => useContext(DialogCtx);
export function DialogProvider({ children }) {
  const [d, setD] = useState(null);
  const [val, setVal] = useState('');
  const confirm = useCallback((opts) => new Promise((resolve) => setD({ kind: 'confirm', ...opts, resolve })), []);
  const prompt = useCallback(
    (opts) =>
      new Promise((resolve) => {
        setVal(opts.value || '');
        setD({ kind: 'prompt', ...opts, resolve });
      }),
    [],
  );
  const close = (result) => {
    d?.resolve(result);
    setD(null);
  };
  return (
    <DialogCtx.Provider value={{ confirm, prompt }}>
      {children}
      <Modal
        open={!!d}
        onClose={() => close(d?.kind === 'prompt' ? null : false)}
        title={d?.title || ''}
        width="max-w-md"
        footer={
          <>
            <Button onClick={() => close(d?.kind === 'prompt' ? null : false)}>Cancel</Button>
            <Button variant={d?.danger ? 'danger' : 'primary'} onClick={() => close(d?.kind === 'prompt' ? val : true)}>
              {d?.confirmLabel || 'OK'}
            </Button>
          </>
        }
      >
        {d?.text && <p className="text-[13px] text-muted">{d.text}</p>}
        {d?.kind === 'prompt' && (
          <input autoFocus className="input mt-2" value={val} placeholder={d.placeholder} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && close(val)} />
        )}
      </Modal>
    </DialogCtx.Provider>
  );
}
