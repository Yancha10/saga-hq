import { X } from 'lucide-react';
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { markDirty } from '../app/status';
import { t, useT } from '../i18n';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger' | 'default';
  size?: 'sm' | 'md';
};
export function Button({
  variant = 'default',
  size = 'md',
  className = '',
  type = 'button',
  ...p
}: BtnProps) {
  return (
    <button
      type={type}
      className={`btn ${variant !== 'default' ? variant : ''} ${size === 'sm' ? 'sm' : ''} ${className}`}
      {...p}
    />
  );
}

export function IconButton({
  label,
  children,
  size,
  className = '',
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 'sm' }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`icon-btn ${size ?? ''} ${className}`}
      {...p}
    >
      {children}
    </button>
  );
}

export function Chip({ on, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean }) {
  return (
    <button type="button" className="chip" aria-pressed={on === undefined ? undefined : on} {...p}>
      {children}
    </button>
  );
}

export function Pill({
  tone,
  children,
  dot,
}: {
  tone?: 'warn' | 'danger' | 'ok' | 'accent' | 'ai';
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span className={`pill ${tone ?? ''}`}>
      {dot && <span className="dot" aria-hidden />}
      {children}
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
  id,
}: {
  label: string;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
  id?: string;
}) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className="field">
      <label className="lbl" htmlFor={fid}>
        {label}
      </label>
      {children(fid)}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

/**
 * Autosaving text input. Keeps a local draft, saves after a short pause and on blur. While a save is
 * pending the app counts as "dirty" (the PWA updater never reloads then). Failures surface globally.
 */
export function AutoText({
  value,
  onSave,
  multiline,
  placeholder,
  className = '',
  id,
  ariaLabel,
  rows,
  delay = 600,
}: {
  value: string | null | undefined;
  onSave: (v: string) => Promise<unknown> | unknown;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
  ariaLabel?: string;
  rows?: number;
  delay?: number;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const focused = useRef(false);
  const latest = useRef(draft);
  latest.current = draft;
  useEffect(() => {
    if (!focused.current && !dirty.current) setDraft(value ?? '');
  }, [value]);
  const flush = async () => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
    if (!dirty.current) return;
    dirty.current = false;
    markDirty(-1);
    try {
      await onSave(latest.current);
    } catch {
      /* surfaced by the store's persistent error banner */
    }
  };
  useEffect(
    () => () => {
      void flush();
    },
    [],
  );
  const onChange = (v: string) => {
    setDraft(v);
    if (!dirty.current) markDirty(1);
    dirty.current = true;
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => void flush(), delay);
  };
  const common = {
    id,
    value: draft,
    placeholder,
    'aria-label': ariaLabel,
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
      void flush();
    },
  };
  if (multiline) {
    return (
      <AutoGrowTextarea
        {...common}
        rows={rows ?? 3}
        className={`textarea ${className}`}
        onChange={(v) => onChange(v)}
      />
    );
  }
  return <input {...common} className={`input ${className}`} onChange={(e) => onChange(e.target.value)} />;
}

function AutoGrowTextarea({
  onChange,
  ...p
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> & { onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 900)}px`;
  }, [p.value]);
  return <textarea ref={ref} {...p} onChange={(e) => onChange(e.target.value)} />;
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  id,
  ariaLabel,
  className = '',
}: {
  value: T | '' | null | undefined;
  onChange: (v: T) => void;
  options: { value: T | ''; label: string }[];
  id?: string;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      className={`select ${className}`}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Section({
  title,
  count,
  action,
  children,
  id,
}: {
  title: ReactNode;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="section" aria-labelledby={id}>
      <div className="section-head">
        <h4 id={id}>
          {title}
          {count !== undefined && count > 0 && <span className="num"> · {count}</span>}
        </h4>
        <span className="spacer" />
        {action}
      </div>
      {children}
    </section>
  );
}

export function Empty({
  title,
  children,
  action,
  compact,
}: {
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty ${compact ? 'compact' : ''}`}>
      {title && <h3>{title}</h3>}
      {children && <div>{children}</div>}
      {action}
    </div>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  dismissable?: boolean;
}) {
  return (
    <ModalOverlay
      className="modal-overlay"
      isOpen={open}
      onOpenChange={(o) => !o && onClose()}
      isDismissable={dismissable}
    >
      <Modal className={`modal ${wide ? 'wide' : ''}`}>
        <Dialog className="dialog" aria-label={title} style={{ outline: 'none' }}>
          <div className="modal-head">
            <Heading slot="title">{title}</Heading>
            <IconButton label={t('common.close')} onClick={onClose}>
              <X size={18} />
            </IconButton>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

export function Confirm({
  open,
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="muted">{body}</div>
    </Sheet>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, label }: { value: number; label?: string }) {
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-label={label ?? t('content.readiness')}
    >
      <span style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Spinner({ label }: { label?: string }) {
  useT();
  label ??= t('common.loading');
  return <span className="spin" role="status" aria-label={label} />;
}
