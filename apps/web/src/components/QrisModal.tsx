import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';
import type { PaymentOrderStatus } from '../lib/types';

type QrisModalProps = {
  isOpen: boolean;
  orderId: string;
  midtransOrderId: string;
  amountIdr: number;
  rcAmount: number;
  qrImageUrl: string;
  expiresAt: string;
  onSuccess: (newBalance: number) => void;
  onClose: () => void;
};

type ModalStatus = 'pending' | 'paid' | 'expired' | 'error';

function formatCountdown(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function QrisModal({
  isOpen,
  orderId,
  midtransOrderId,
  amountIdr,
  rcAmount,
  qrImageUrl,
  expiresAt,
  onSuccess,
  onClose,
}: QrisModalProps) {
  const [status, setStatus] = useState<ModalStatus>('pending');
  const [timeLeft, setTimeLeft] = useState(0);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const notifiedRef = useRef(false);
  const paidBalanceRef = useRef(rcAmount);
  const onSuccessRef = useRef(onSuccess);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  const markPaid = useCallback(
    (remainingRc: number) => {
      paidBalanceRef.current = Number.isFinite(remainingRc) ? remainingRc : rcAmount;
      setStatus('paid');
      setMessage(null);
    },
    [rcAmount],
  );

  const closeModal = useCallback(() => {
    if (status === 'paid' && !notifiedRef.current) {
      notifiedRef.current = true;
      onSuccessRef.current(paidBalanceRef.current);
    }
    onClose();
  }, [onClose, status]);

  // Reset state saat order baru dibuka.
  useEffect(() => {
    if (!isOpen || !orderId) return;
    notifiedRef.current = false;
    paidBalanceRef.current = rcAmount;
    setStatus('pending');
    setChecking(false);
    setMessage(null);
    setImageError(false);
    setShowCancelConfirm(false);
    setCancelling(false);
    setTimeLeft(Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000)));
  }, [isOpen, orderId, expiresAt, rcAmount]);

  // Countdown dari expiresAt.
  useEffect(() => {
    if (!isOpen || status !== 'pending') return;

    function tick() {
      const remaining = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) {
        setStatus((current) => (current === 'pending' ? 'expired' : current));
      }
    }

    tick();
    const interval = window.setInterval(tick, 1_000);
    return () => window.clearInterval(interval);
  }, [expiresAt, isOpen, status]);

  const checkPayment = useCallback(
    async (manual: boolean) => {
      if (checking || status !== 'pending') return;

      setChecking(true);
      if (manual) setMessage(null);

      try {
        const data = await api<PaymentOrderStatus>(`/api/payment/${orderId}/status`);

        if (data.status === 'paid') {
          markPaid(Number(data.remainingRc));
        } else if (data.status === 'expired') {
          setStatus('expired');
        } else if (data.status === 'cancelled' || data.status === 'failed') {
          setStatus('error');
          setMessage('Pembayaran gagal atau dibatalkan.');
        } else if (manual) {
          setMessage('Belum terkonfirmasi, coba lagi dalam beberapa detik.');
        }
      } catch (caught) {
        if (manual) {
          setMessage(caught instanceof Error ? caught.message : 'Gagal memeriksa status');
        }
      } finally {
        setChecking(false);
      }
    },
    [checking, markPaid, orderId, status],
  );

  const cancelPayment = useCallback(async () => {
    if (cancelling) return;

    setCancelling(true);
    setMessage(null);

    try {
      const data = await api<PaymentOrderStatus>(`/api/payment/${orderId}/cancel`, {
        method: 'POST',
      });

      if (data.status === 'paid') {
        markPaid(Number(data.remainingRc));
        return;
      }

      closeModal();
    } catch (caught) {
      setShowCancelConfirm(false);
      setMessage(caught instanceof Error ? caught.message : 'Gagal membatalkan pembayaran');
    } finally {
      setCancelling(false);
    }
  }, [cancelling, closeModal, markPaid, orderId]);

  // Polling otomatis setiap 10 detik selama masih pending.
  useEffect(() => {
    if (!isOpen || status !== 'pending') return;

    const interval = window.setInterval(() => {
      void checkPayment(false);
    }, 10_000);

    return () => window.clearInterval(interval);
  }, [checkPayment, isOpen, status]);

  useEffect(() => {
    if (!isOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeModal();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeModal, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center px-4">
      <button
        type="button"
        aria-label="Tutup modal"
        onClick={closeModal}
        className="absolute inset-0 cursor-default bg-black/60"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="qris-modal-title"
        className="relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto border border-line bg-paper p-6 shadow-2xl dark:bg-[#1a1a18]"
      >
        <div className="flex items-start justify-between gap-4">
          <h2
            id="qris-modal-title"
            className={status === 'paid' ? 'sr-only' : 'text-lg font-semibold'}
          >
            {status === 'paid' ? 'Pembayaran berhasil' : 'Scan QR untuk membayar'}
          </h2>
          <button
            type="button"
            aria-label="Tutup"
            onClick={closeModal}
            className="-mt-2 -mr-2 inline-flex size-11 shrink-0 items-center justify-center text-2xl leading-none text-muted transition-colors duration-150 hover:text-ink"
          >
            ×
          </button>
        </div>

        {status === 'paid' ? (
          <div className="pt-2">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-2 border-petrol bg-petrol/20">
              <span className="text-center text-2xl font-bold text-petrol">✓</span>
            </div>
            <p className="mt-4 text-center text-lg font-semibold">Pembayaran Berhasil!</p>
            <p className="mt-1 text-center font-mono text-sm text-muted">
              +{formatNumber(rcAmount)} RC ditambahkan ke saldo kamu
            </p>
            <p className="mt-3 text-center font-mono text-sm text-muted">
              Rp {formatNumber(amountIdr)}
            </p>
            <button
              type="button"
              onClick={closeModal}
              className="mt-6 w-full bg-oxide py-3 text-sm font-medium text-chalk transition-opacity duration-150 hover:opacity-90"
            >
              Selesai
            </button>
          </div>
        ) : (
          <>
            <div className="mx-auto mt-5 flex h-48 w-48 items-center justify-center border border-line p-2">
              {qrImageUrl && !imageError ? (
                <img
                  src={qrImageUrl}
                  alt="QR pembayaran QRIS"
                  className="h-full w-full object-contain"
                  onError={() => setImageError(true)}
                />
              ) : (
                <p className="px-2 text-center text-xs leading-relaxed text-muted">
                  QR tidak dapat ditampilkan. Gunakan kode:{' '}
                  <span className="break-all font-mono text-ink">{midtransOrderId}</span>
                </p>
              )}
            </div>

            <div className="mt-4 space-y-1 text-center">
              <p className="font-mono text-sm font-medium">Total: Rp {formatNumber(amountIdr)}</p>
              <p className="font-mono text-sm text-muted">
                RC didapat: {formatNumber(rcAmount)} RC
              </p>
            </div>

            {status === 'pending' ? (
              <p
                className={`mt-2 text-center font-mono text-xs ${
                  timeLeft < 60 ? 'text-oxide' : 'text-muted'
                }`}
              >
                Berlaku selama {formatCountdown(timeLeft)}
              </p>
            ) : null}

            <div className="mt-4 flex items-center justify-center gap-2 text-sm">
              <span
                className={`size-2 rounded-full ${
                  status === 'pending' ? 'animate-pulse bg-yellow-500' : 'bg-oxide'
                }`}
              />
              <span className={status === 'pending' ? 'text-muted' : 'font-medium'}>
                {status === 'pending'
                  ? 'Menunggu pembayaran...'
                  : status === 'expired'
                    ? 'QR kedaluwarsa'
                    : (message ?? 'Pembayaran gagal')}
              </span>
            </div>

            {message && status === 'pending' ? (
              <p className="mt-2 text-center text-xs text-muted">{message}</p>
            ) : null}

            {status === 'pending' ? (
              <>
                <button
                  type="button"
                  onClick={() => void checkPayment(true)}
                  disabled={checking || cancelling}
                  className="mt-5 w-full bg-oxide py-2.5 text-sm font-medium text-chalk transition-opacity duration-150 hover:opacity-90 disabled:opacity-60"
                >
                  {checking ? 'Memeriksa…' : 'Cek Pembayaran'}
                </button>
                {showCancelConfirm ? (
                  <div className="mt-3">
                    <p className="mb-2 text-center text-xs text-muted">Batalkan pembayaran ini?</p>
                    <div className="flex justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowCancelConfirm(false)}
                        disabled={cancelling}
                        className="border border-line px-3 py-1 text-xs text-muted transition-colors duration-150 hover:text-ink disabled:opacity-40"
                      >
                        Tidak, lanjutkan
                      </button>
                      <button
                        type="button"
                        onClick={() => void cancelPayment()}
                        disabled={cancelling}
                        className="border border-oxide px-3 py-1 text-xs text-oxide transition-colors duration-150 hover:bg-oxide/5 disabled:opacity-40"
                      >
                        {cancelling ? 'Membatalkan…' : 'Ya, batalkan'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowCancelConfirm(true)}
                    className="mt-3 w-full text-center text-xs text-muted transition-colors duration-150 hover:text-ink"
                  >
                    Batalkan
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={closeModal}
                className="mt-5 w-full bg-oxide py-2.5 text-sm font-medium text-chalk transition-opacity duration-150 hover:opacity-90"
              >
                Tutup
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
