import { useCallback, useEffect, useState } from 'react';
import { QrisModal } from '../components/QrisModal';
import { useAuth } from '../features/auth/AuthProvider';
import { api } from '../lib/api';
import { formatDate, formatNumber } from '../lib/format';
import type {
  PaymentHistoryOrder,
  PaymentHistoryResponse,
  PaymentOrder,
  PaymentOrderStatus,
  RcPackage,
} from '../lib/types';

const rateFormatter = new Intl.NumberFormat('id-ID', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatRate(value: number): string {
  return Number.isFinite(value) ? rateFormatter.format(value) : '-';
}

type OrderStatus = PaymentHistoryOrder['status'];

const STATUS_META: Record<OrderStatus, { label: string; className: string }> = {
  paid: { label: 'Berhasil', className: 'border-petrol/40 bg-petrol/10 text-petrol' },
  pending: {
    label: 'Menunggu',
    className: 'border-yellow-600/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
  },
  expired: { label: 'Kedaluwarsa', className: 'border-line bg-ink/5 text-muted' },
  cancelled: { label: 'Dibatalkan', className: 'border-line bg-ink/5 text-muted' },
  failed: { label: 'Gagal', className: 'border-oxide/40 bg-oxide/10 text-oxide' },
};

function StatusBadge({ status }: { status: OrderStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`shrink-0 border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

export function getRcForAmount(idr: number): number | null {
  if (!Number.isFinite(idr) || !Number.isInteger(idr) || idr < 2_000) return null;
  if (idr < 5_000) return Math.floor((idr * 6_500) / 2_000);
  if (idr < 10_000) return Math.floor((idr * 16_500) / 5_000);
  if (idr < 20_000) return Math.floor((idr * 33_500) / 10_000);
  if (idr < 50_000) return Math.floor((idr * 67_500) / 20_000);
  if (idr < 100_000) return Math.floor((idr * 170_000) / 50_000);
  return Math.floor((idr * 350_000) / 100_000);
}

export function TopupPage() {
  const { wallet, refresh } = useAuth();
  const [packages, setPackages] = useState<RcPackage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [history, setHistory] = useState<PaymentHistoryOrder[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyMeta, setHistoryMeta] = useState({ page: 1, pageSize: 10, total: 0 });
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);

  const loadHistory = useCallback(async (page: number) => {
    setHistoryError(null);
    try {
      const data = await api<PaymentHistoryResponse>(`/api/payment/orders?page=${page}`);
      setHistory(data.data);
      setHistoryMeta({ page: data.page, pageSize: data.pageSize, total: data.total });
    } catch (caught) {
      setHistoryError(caught instanceof Error ? caught.message : 'Gagal memuat riwayat transaksi');
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    void loadHistory(1);
  }, [loadHistory]);

  useEffect(() => {
    async function load() {
      try {
        const data = await api<{ data: RcPackage[] }>('/api/user/packages');
        setPackages(data.data);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Gagal memuat paket');
      }
    }
    void load();
  }, []);

  useEffect(() => {
    if (!toast) return;
    setToastVisible(true);
    const hide = window.setTimeout(() => setToastVisible(false), 4_700);
    const clear = window.setTimeout(() => setToast(null), 5_000);
    return () => {
      window.clearTimeout(hide);
      window.clearTimeout(clear);
    };
  }, [toast]);

  const selected = packages?.find((item) => item.id === selectedId) ?? null;
  const customValue = customAmount.trim() === '' ? null : Number(customAmount);
  const customRc = customValue == null ? null : getRcForAmount(customValue);

  const summary = selected
    ? { nominal: selected.priceIdr, rc: selected.rcAmount, rate: selected.rcPerRupiah }
    : customRc != null && customValue != null
      ? { nominal: customValue, rc: customRc, rate: customRc / customValue }
      : null;

  function selectPackage(pkg: RcPackage) {
    setSelectedId(pkg.id);
    setCustomAmount('');
    setPayError(null);
  }

  async function startPayment() {
    if (!summary || paying) return;

    setPaying(true);
    setPayError(null);
    try {
      const data = await api<PaymentOrder>('/api/payment/create', {
        method: 'POST',
        body: JSON.stringify({
          ...(selected ? { packageId: selected.id } : {}),
          amountIdr: summary.nominal,
          rcAmount: summary.rc,
        }),
      });
      setOrder(data);
    } catch (caught) {
      setPayError(caught instanceof Error ? caught.message : 'Gagal membuat pembayaran');
    } finally {
      setPaying(false);
    }
  }

  function handlePaymentSuccess() {
    const rc = order?.rcAmount;
    void refresh();
    if (rc != null) {
      setToast({
        id: Date.now(),
        message: `Top up berhasil! +${formatNumber(rc)} RC ditambahkan.`,
      });
    }
  }

  function handleOrderClose() {
    setOrder(null);
    setHistoryNotice(null);
    void loadHistory(1);
  }

  function canResume(item: PaymentHistoryOrder): boolean {
    return (
      item.status === 'pending' &&
      Boolean(item.qrImageUrl) &&
      Boolean(item.midtransOrderId) &&
      new Date(item.expiresAt).getTime() > Date.now()
    );
  }

  async function resumeOrder(item: PaymentHistoryOrder) {
    if (resumingId) return;

    setResumingId(item.id);
    setHistoryNotice(null);

    try {
      const status = await api<PaymentOrderStatus>(`/api/payment/${item.id}/status`);

      if (status.status === 'pending') {
        if (!item.qrImageUrl) {
          setHistoryNotice('QR pembayaran untuk transaksi ini tidak tersedia.');
          return;
        }

        setOrder({
          orderId: status.orderId,
          midtransOrderId: status.midtransOrderId ?? item.midtransOrderId ?? '',
          amountIdr: status.amountIdr,
          rcAmount: status.rcAmount,
          qrString: '',
          qrImageUrl: item.qrImageUrl,
          expiresAt: status.expiresAt,
          status: 'pending',
        });
        return;
      }

      if (status.status === 'paid') {
        void refresh();
        setToast({
          id: Date.now(),
          message: `Top up berhasil! +${formatNumber(status.rcAmount)} RC ditambahkan.`,
        });
      } else {
        setHistoryNotice(`Transaksi ini sudah ${STATUS_META[status.status].label.toLowerCase()}.`);
      }

      void loadHistory(historyMeta.page);
    } catch (caught) {
      setHistoryNotice(caught instanceof Error ? caught.message : 'Gagal membuka pembayaran');
    } finally {
      setResumingId(null);
    }
  }

  const historyTotalPages = Math.max(1, Math.ceil(historyMeta.total / historyMeta.pageSize));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-12">
      <header className="border-b border-line pb-6">
        <h1 className="text-3xl font-bold tracking-[-0.04em]">Top Up</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
          Pilih paket atau masukkan nominal sendiri.
        </p>
        <p className="mt-3 font-mono text-sm text-muted">
          Saldo saat ini:{' '}
          <span className="text-ink">{formatNumber(wallet?.remainingRc ?? 0)} RC</span>
        </p>
      </header>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-medium">Paket tersedia</h2>

        {error ? (
          <p role="alert" className="border-l-2 border-oxide pl-3 text-sm text-oxide">
            {error}
          </p>
        ) : packages == null ? (
          <p className="text-sm text-muted">Memuat paket…</p>
        ) : packages.length === 0 ? (
          <p className="border border-line bg-chalk p-4 text-sm text-muted dark:bg-chalk/5">
            Belum ada paket aktif. Gunakan nominal sendiri di bawah.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {packages.map((pkg) => {
              const isSelected = pkg.id === selectedId;
              return (
                <button
                  key={pkg.id}
                  type="button"
                  onClick={() => selectPackage(pkg)}
                  aria-pressed={isSelected}
                  className={`relative border p-4 text-left transition-colors duration-150 ${
                    isSelected
                      ? 'border-oxide bg-oxide/5'
                      : 'border-line bg-chalk hover:border-ink/40 dark:bg-chalk/5'
                  }`}
                >
                  {pkg.name === 'Pro' ? (
                    <span className="absolute top-0 right-0 bg-oxide px-1.5 py-0.5 font-mono text-[10px] text-chalk">
                      Populer
                    </span>
                  ) : null}
                  <p className="text-sm font-medium">{pkg.name}</p>
                  <p className="mt-1 font-mono text-xl font-bold">
                    {formatNumber(pkg.rcAmount)} RC
                  </p>
                  <p className="mt-1 text-sm text-muted">Rp {formatNumber(pkg.priceIdr)}</p>
                  <p className="mt-0.5 font-mono text-xs text-muted">
                    {formatRate(pkg.rcPerRupiah)} RC/Rp
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-medium">Atau masukkan nominal</h2>

        <div className="flex border border-line bg-paper focus-within:border-ink dark:bg-chalk/5">
          <span className="border-r border-line px-3 py-2 font-mono text-sm text-muted">Rp</span>
          <input
            type="number"
            min={2_000}
            step={1_000}
            inputMode="numeric"
            placeholder="10.000"
            value={customAmount}
            onFocus={() => setSelectedId(null)}
            onChange={(event) => {
              setSelectedId(null);
              setPayError(null);
              setCustomAmount(event.target.value);
            }}
            className="min-h-10 w-full bg-transparent px-3 py-2 font-mono text-sm outline-none"
          />
        </div>

        {customValue == null ? null : customRc == null ? (
          <p className="mt-2 text-xs text-oxide">Minimal Rp 2.000</p>
        ) : (
          <>
            <p className="mt-2 font-mono text-sm text-petrol">= {formatNumber(customRc)} RC</p>
            <p className="font-mono text-xs text-muted">
              Rate: {formatRate(customRc / customValue)} RC/Rp
            </p>
          </>
        )}
      </section>

      {summary ? (
        <section className="mt-6 border border-line bg-chalk p-4 dark:bg-chalk/5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted">Nominal</span>
            <span className="font-mono">Rp {formatNumber(summary.nominal)}</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-3 text-sm">
            <span className="text-muted">RC didapat</span>
            <span className="font-mono font-medium">{formatNumber(summary.rc)} RC</span>
          </div>
          <div className="my-3 border-t border-line" />
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted">Total bayar</span>
            <span className="font-medium">Rp {formatNumber(summary.nominal)}</span>
          </div>

          {payError ? (
            <p role="alert" className="mt-3 border-l-2 border-oxide pl-3 text-sm text-oxide">
              {payError}
            </p>
          ) : null}

          <button
            type="button"
            onClick={() => void startPayment()}
            disabled={paying}
            className="mt-4 w-full bg-oxide py-3 text-sm font-medium text-chalk transition-opacity duration-150 hover:opacity-90 disabled:opacity-60"
          >
            {paying ? 'Memproses…' : 'Bayar dengan QRIS'}
          </button>
          <p className="mt-2 text-center font-mono text-xs text-muted">
            Pembayaran diproses via Midtrans QRIS.
          </p>
        </section>
      ) : null}

      {order ? (
        <QrisModal
          isOpen
          orderId={order.orderId}
          midtransOrderId={order.midtransOrderId}
          amountIdr={order.amountIdr}
          rcAmount={order.rcAmount}
          qrImageUrl={order.qrImageUrl}
          expiresAt={order.expiresAt}
          onSuccess={handlePaymentSuccess}
          onClose={handleOrderClose}
        />
      ) : null}

      <section className="mt-10 border-t border-line pt-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium">Riwayat transaksi</h2>
          {history != null && historyMeta.total > 0 ? (
            <span className="font-mono text-xs text-muted">
              {formatNumber(historyMeta.total)} transaksi
            </span>
          ) : null}
        </div>

        {historyNotice ? (
          <p role="status" className="mt-3 border-l-2 border-oxide pl-3 text-xs text-oxide">
            {historyNotice}
          </p>
        ) : null}

        {historyError ? (
          <div role="alert" className="mt-3 border-l-2 border-oxide pl-3 text-sm text-oxide">
            <p>{historyError}</p>
            <button
              type="button"
              onClick={() => void loadHistory(historyMeta.page)}
              className="mt-1 text-xs underline underline-offset-2"
            >
              Coba lagi
            </button>
          </div>
        ) : history == null ? (
          <p className="mt-4 border-t border-line py-8 text-center text-sm text-muted">
            Memuat riwayat…
          </p>
        ) : history.length === 0 ? (
          <p className="mt-4 border border-line bg-chalk p-4 text-sm text-muted dark:bg-chalk/5">
            Belum ada transaksi. Riwayat top up akan muncul di sini.
          </p>
        ) : (
          <>
            <ul className="mt-3 border border-line bg-chalk dark:bg-chalk/5">
              {history.map((item) => (
                <li
                  key={item.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.packageName}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted">
                      {formatDate(item.createdAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm whitespace-nowrap">
                      Rp {formatNumber(item.amountIdr)}
                    </p>
                    <p
                      className={`font-mono text-xs whitespace-nowrap ${
                        item.status === 'paid' ? 'text-petrol' : 'text-muted'
                      }`}
                    >
                      {item.status === 'paid' ? '+' : ''}
                      {formatNumber(item.rcAmount)} RC
                    </p>
                  </div>
                  <div className="col-span-2 flex items-center justify-end gap-2 sm:col-span-1">
                    <StatusBadge status={item.status} />
                    {canResume(item) ? (
                      <button
                        type="button"
                        onClick={() => void resumeOrder(item)}
                        disabled={resumingId === item.id}
                        className="inline-flex min-h-9 shrink-0 items-center justify-center border border-oxide px-3 text-xs text-oxide transition-colors duration-150 hover:bg-oxide/5 disabled:opacity-40"
                      >
                        {resumingId === item.id ? 'Membuka…' : 'Lanjutkan'}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>

            {historyTotalPages > 1 ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="font-mono text-xs text-muted">
                  Halaman {historyMeta.page} dari {historyTotalPages}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void loadHistory(historyMeta.page - 1)}
                    disabled={historyMeta.page <= 1}
                    className="border border-line bg-chalk px-3 py-1 text-sm transition-colors duration-150 hover:border-ink disabled:text-muted disabled:opacity-40 dark:bg-chalk/5"
                  >
                    Sebelumnya
                  </button>
                  <button
                    type="button"
                    onClick={() => void loadHistory(historyMeta.page + 1)}
                    disabled={historyMeta.page >= historyTotalPages}
                    className="border border-line bg-chalk px-3 py-1 text-sm transition-colors duration-150 hover:border-ink disabled:text-muted disabled:opacity-40 dark:bg-chalk/5"
                  >
                    Berikutnya
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>

      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 border border-petrol/50 bg-petrol px-4 py-2 text-sm text-chalk transition-opacity duration-300 ${
            toastVisible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
