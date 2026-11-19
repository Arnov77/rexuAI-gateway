import { useCallback, useEffect, useState } from 'react';
import { ConfirmModal } from '../../components/ConfirmModal';
import { api } from '../../lib/api';
import { formatNumber } from '../../lib/format';
import type { AdminUsageLog } from '../../lib/types';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function tokenTotal(log: AdminUsageLog): number {
  const tokens = (log.contextTokens ?? 0) + (log.generationTokens ?? 0);
  return tokens > 0 ? tokens : log.rawTokens;
}

function estimateRc(log: AdminUsageLog): string {
  const tokens = tokenTotal(log);
  const bankai = (log.bankaiMultiplierBp ?? 10_000) / 10_000;
  const rexu = (log.multiplierBp ?? 10_000) / 10_000;
  const rc = (tokens * bankai * rexu) / 1_000;
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(rc);
}

function ReconcileButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-xs text-oxide hover:underline">
      Rekonsiliasi
    </button>
  );
}

export function AdminReconcilePage() {
  const [logs, setLogs] = useState<AdminUsageLog[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminUsageLog | null>(null);
  const [prompt, setPrompt] = useState('');
  const [completion, setCompletion] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expireOpen, setExpireOpen] = useState(false);
  const [expireBusy, setExpireBusy] = useState(false);
  const [expireError, setExpireError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ data: AdminUsageLog[]; total?: number }>(
        '/api/admin/usage?status=reconciliation&limit=100',
      );
      setLogs(data.data);
      setTotal(data.total ?? data.data.length);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal memuat data rekonsiliasi');
      setLogs([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function notifySidebar() {
    window.dispatchEvent(new Event('rexu:reconcile-updated'));
  }

  function openReconcile(log: AdminUsageLog) {
    setSelected(log);
    setPrompt(String(log.contextTokens ?? 0));
    setCompletion(String(log.generationTokens ?? 0));
    setModalError(null);
    setError(null);
  }

  async function reconcile() {
    if (!selected) return;
    const promptTokens = Number(prompt);
    const completionTokens = Number(completion);
    if (
      !Number.isInteger(promptTokens) ||
      promptTokens < 0 ||
      !Number.isInteger(completionTokens) ||
      completionTokens < 0
    ) {
      setModalError('Token harus bilangan bulat dan tidak negatif');
      return;
    }

    setBusy(true);
    setModalError(null);
    try {
      await api(`/api/admin/usage/${selected.id}/reconcile`, {
        method: 'POST',
        body: JSON.stringify({ promptTokens, completionTokens }),
      });
      setSelected(null);
      setSuccess('Berhasil direkonsiliasi');
      setError(null);
      await load();
      notifySidebar();
    } catch (caught) {
      setModalError(caught instanceof Error ? caught.message : 'Gagal merekonsiliasi request');
    } finally {
      setBusy(false);
    }
  }

  async function expire() {
    setExpireBusy(true);
    setExpireError(null);
    try {
      const data = await api<{ data: { released: number } }>('/api/admin/usage/reconcile-expired', {
        method: 'POST',
      });
      setExpireOpen(false);
      setSuccess(
        data.data.released > 0
          ? `${data.data.released} reservasi kedaluwarsa dilepas.`
          : 'Tidak ada reservasi kedaluwarsa.',
      );
      setError(null);
      await load();
      notifySidebar();
    } catch (caught) {
      setExpireError(caught instanceof Error ? caught.message : 'Gagal melepas reservasi');
    } finally {
      setExpireBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-[-0.04em]">Rekonsiliasi</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            Selesaikan request yang gagal dicatat billing-nya.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setExpireError(null);
            setExpireOpen(true);
          }}
          className="border border-line bg-chalk px-3 py-2 text-sm font-medium text-ink transition-colors duration-150 hover:border-ink dark:bg-chalk/5"
        >
          Lepas yang Kedaluwarsa
        </button>
      </div>

      {success ? (
        <p className="mt-4 border-l-2 border-petrol pl-3 text-xs text-petrol">{success}</p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 border-l-2 border-oxide pl-3 text-xs text-oxide">
          {error}
        </p>
      ) : null}

      {logs == null ? (
        <p className="border-t border-line py-10 text-center text-sm text-muted">
          Memuat data rekonsiliasi…
        </p>
      ) : logs.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">
          Tidak ada request yang perlu direkonsiliasi.
        </p>
      ) : (
        <>
          {total > logs.length ? (
            <p className="mt-4 font-mono text-xs text-muted">
              Menampilkan {formatNumber(logs.length)} dari {formatNumber(total)} request.
            </p>
          ) : null}

          <div className="mt-4 hidden overflow-x-auto border border-line bg-chalk md:block dark:bg-chalk/5">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Waktu
                  </th>
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    User
                  </th>
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Model
                  </th>
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Token
                  </th>
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    RC Est.
                  </th>
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Aksi
                  </th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-line align-middle last:border-b-0">
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-xs">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-mono text-xs text-muted">
                        {log.userEmail ?? log.userId}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-mono text-xs">{log.modelId ?? '—'}</span>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">
                      {formatNumber(log.contextTokens)} + {formatNumber(log.generationTokens)}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-muted">
                      ~{estimateRc(log)} RC
                    </td>
                    <td className="px-3 py-3">
                      <ReconcileButton onClick={() => openReconcile(log)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 space-y-3 md:hidden">
            {logs.map((log) => (
              <div key={log.id} className="border border-line bg-chalk p-4 dark:bg-chalk/5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-xs">{log.modelId ?? '—'}</p>
                    <p className="mt-1 truncate font-mono text-xs text-muted">
                      {log.userEmail ?? log.userId}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-xs text-muted">
                    {formatDateTime(log.createdAt)}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs">
                    {formatNumber(log.contextTokens)} + {formatNumber(log.generationTokens)} token
                  </span>
                  <span className="font-mono text-xs text-muted">~{estimateRc(log)} RC</span>
                </div>
                <div className="mt-3 border-t border-line pt-3">
                  <ReconcileButton onClick={() => openReconcile(log)} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {selected ? (
        <ConfirmModal
          title="Rekonsiliasi request ini?"
          description="Masukkan token aktual jika berbeda dari yang tercatat."
          confirmLabel="Rekonsiliasi"
          busy={busy}
          error={modalError}
          onConfirm={() => void reconcile()}
          onClose={() => {
            if (!busy) setSelected(null);
          }}
        >
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs text-muted">Prompt tokens</span>
              <input
                type="number"
                min={0}
                step={1}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                className="mt-1 block min-h-9 w-full border border-line bg-paper px-2 font-mono text-sm text-ink outline-none focus:border-ink dark:bg-chalk/5"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted">Completion tokens</span>
              <input
                type="number"
                min={0}
                step={1}
                value={completion}
                onChange={(event) => setCompletion(event.target.value)}
                className="mt-1 block min-h-9 w-full border border-line bg-paper px-2 font-mono text-sm text-ink outline-none focus:border-ink dark:bg-chalk/5"
              />
            </label>
          </div>
        </ConfirmModal>
      ) : null}

      {expireOpen ? (
        <ConfirmModal
          title="Lepas reservasi kedaluwarsa?"
          description="Semua reservasi yang sudah melewati batas waktu akan dilepas kembali ke saldo pengguna."
          confirmLabel="Lepas"
          busy={expireBusy}
          error={expireError}
          onConfirm={() => void expire()}
          onClose={() => {
            if (!expireBusy) setExpireOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
