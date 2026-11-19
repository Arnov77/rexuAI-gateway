import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { ApiKey } from '../lib/types';
import { RawKeyModal } from './RawKeyModal';

type RegenerateResponse = {
  key: string;
  id: string;
  name: string;
  keyPrefix: string;
  lastFour: string;
};

type RegenerateKeyModalProps = {
  apiKey: ApiKey;
  onClose: () => void;
  onDone: () => void;
};

export function RegenerateKeyModal({ apiKey, onClose, onDone }: RegenerateKeyModalProps) {
  const [phase, setPhase] = useState<'confirm' | 'success'>('confirm');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    modalRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && phase === 'confirm' && !busy) onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase, busy, onClose]);

  async function regenerate() {
    setBusy(true);
    setError(null);
    try {
      const data = await api<RegenerateResponse>(`/api/user/keys/${apiKey.id}/regenerate`, {
        method: 'POST',
      });
      setNewKey(data.key);
      setPhase('success');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal me-regenerate key');
    } finally {
      setBusy(false);
    }
  }

  function closeConfirm() {
    if (!busy) onClose();
  }

  if (phase === 'success' && newKey) {
    return <RawKeyModal isOpen={true} rawKey={newKey} onClose={onDone} />;
  }

  return (
    <>
      <button
        type="button"
        aria-label="Tutup modal"
        tabIndex={-1}
        onClick={closeConfirm}
        className={`fixed inset-0 z-50 cursor-default bg-ink/50 transition-opacity duration-200 dark:bg-black/60 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="regenerate-key-title"
        tabIndex={-1}
        className={`fixed top-1/2 left-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 border border-line bg-paper p-6 transition-[opacity,transform] duration-200 outline-none dark:bg-[#1a1a18] ${
          visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
      >
        <h2 id="regenerate-key-title" className="text-lg font-semibold">
          Regenerate key?
        </h2>

        <p className="mt-2 text-sm leading-relaxed text-muted">
          Key lama akan langsung tidak aktif. Pastikan tidak ada aplikasi yang masih memakainya.
        </p>
        <code className="mt-3 inline-block border border-line px-2 py-1 font-mono text-sm">
          {apiKey.name}
        </code>

        {error ? (
          <p role="alert" className="mt-3 border-l-2 border-oxide pl-3 text-xs text-oxide">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={closeConfirm}
            disabled={busy}
            className="border border-line px-4 py-2 text-sm disabled:opacity-60"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => void regenerate()}
            disabled={busy}
            className="bg-oxide px-4 py-2 text-sm text-chalk disabled:opacity-60"
          >
            {busy ? 'Memproses...' : 'Regenerate'}
          </button>
        </div>
      </div>
    </>
  );
}
