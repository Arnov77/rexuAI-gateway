import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';

type ConfirmVariant = 'danger' | 'warning';

type ConfirmModalProps = {
  isOpen?: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  confirmVariant?: ConfirmVariant;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
  /** Legacy alias for onCancel. */
  onClose?: () => void;
  loading?: boolean;
  /** Legacy alias for loading. */
  busy?: boolean;
  error?: string | null;
  cancelLabel?: string;
  children?: ReactNode;
};

const confirmStyles: Record<ConfirmVariant, string> = {
  danger: 'bg-oxide text-chalk',
  warning: 'border border-oxide text-oxide',
};

export function ConfirmModal({
  isOpen = true,
  title,
  description,
  confirmLabel = 'Konfirmasi',
  confirmVariant = 'danger',
  onConfirm,
  onCancel,
  onClose,
  loading = false,
  busy = false,
  error = null,
  cancelLabel = 'Batal',
  children,
}: ConfirmModalProps) {
  const [visible, setVisible] = useState(false);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const isBusy = loading || busy;

  const handleCancel = useCallback(() => {
    if (isBusy) return;
    (onCancel ?? onClose)?.();
  }, [isBusy, onCancel, onClose]);

  useEffect(() => {
    if (!isOpen) {
      setVisible(false);
      return;
    }
    const frame = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    modalRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') handleCancel();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, handleCancel]);

  if (!isOpen) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Tutup modal"
        tabIndex={-1}
        onClick={handleCancel}
        className={`fixed inset-0 z-50 cursor-default bg-ink/50 transition-opacity duration-200 dark:bg-black/60 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`fixed top-1/2 left-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 border border-line bg-paper p-6 transition-[opacity,transform] duration-200 outline-none dark:bg-[#1a1a18] ${
          visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {description ? (
          <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
        ) : null}

        {children ? <div className="mt-4">{children}</div> : null}

        {error ? (
          <p role="alert" className="mt-3 text-xs text-oxide">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isBusy}
            className="border border-line px-4 py-2 text-sm disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isBusy}
            className={`px-4 py-2 text-sm disabled:opacity-60 ${confirmStyles[confirmVariant]}`}
          >
            {isBusy ? '...' : confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
