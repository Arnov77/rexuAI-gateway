import { useEffect, useId, useRef, useState } from 'react';

type RawKeyModalProps = {
  isOpen: boolean;
  rawKey: string;
  onClose: () => void;
};

export function RawKeyModal({ isOpen, rawKey, onClose }: RawKeyModalProps) {
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

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

  async function copyKey() {
    if (!rawKey) return;
    try {
      await navigator.clipboard.writeText(rawKey);
    } catch {
      // Clipboard API needs a secure context (https/localhost); fall back to a
      // temporary textarea so copying still works on plain-http hosts.
      const textarea = document.createElement('textarea');
      textarea.value = rawKey;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop intentionally has no click handler: the raw key modal can only
          be dismissed with the explicit "Saya sudah menyimpannya" button. */}
      <div
        aria-hidden="true"
        className={`fixed inset-0 z-50 bg-ink/50 transition-opacity duration-200 dark:bg-black/60 ${
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
          Key berhasil dibuat
        </h2>

        <div className="mt-3 border border-oxide/30 bg-oxide/5 p-3 text-xs text-oxide">
          Simpan key ini sekarang. Tidak bisa ditampilkan lagi.
        </div>

        <div className="mt-3 border border-line">
          <div className="flex items-center justify-between gap-3 border-b border-line bg-ink/20 px-3 py-2">
            <span className="font-mono text-xs text-muted">API Key</span>
            <button
              type="button"
              onClick={() => void copyKey()}
              className="border border-line px-2 py-1 text-xs transition-colors duration-150 hover:border-ink hover:text-ink"
            >
              {copied ? 'Tersalin ✓' : 'Salin'}
            </button>
          </div>
          <div className="break-all bg-[#14171a] px-3 py-3 font-mono text-sm text-[#f6f4ee] select-all">
            {rawKey}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full border border-line py-2 text-sm text-muted hover:border-ink hover:text-ink"
        >
          Saya sudah menyimpannya
        </button>
      </div>
    </>
  );
}
