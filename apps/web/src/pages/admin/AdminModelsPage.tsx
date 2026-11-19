import { Fragment, useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { Model } from '../../lib/types';

type SyncResult = {
  synced: number;
  created: number;
  missing: number;
  skippedFree: number;
};

function formatMultiplier(value: number | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 4 }).format(value);
}

const tokenFormatter = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

function formulaMinBlock(model: Model): number {
  const bankaiMultiplierBp = model.bankaiMultiplierBp ?? 10_000;
  return Math.floor((2_048 * bankaiMultiplierBp) / 10_000);
}

/** Rexu multiplier falls back to the BankAI multiplier when it is not set. */
function effectiveRexuMultiplier(model: Model): number | null {
  return model.multiplier ?? model.bankaiMultiplier ?? null;
}

function StatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`inline-block border px-2 py-0.5 text-[10px] font-medium ${
        enabled
          ? 'border-petrol/20 bg-petrol/10 text-petrol'
          : 'border-muted/20 bg-muted/10 text-muted'
      }`}
    >
      {enabled ? 'Aktif' : 'Nonaktif'}
    </span>
  );
}

export function AdminModelsPage() {
  const [models, setModels] = useState<Model[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftMultiplier, setDraftMultiplier] = useState('');
  const [draftBankai, setDraftBankai] = useState('');
  const [draftMinBlock, setDraftMinBlock] = useState('');
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ data: Model[] }>('/api/admin/models');
      setModels(data.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal memuat model');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function sync() {
    setSyncBusy(true);
    setError(null);
    setSyncMessage(null);
    try {
      const data = await api<{ data: SyncResult }>('/api/admin/models/sync', { method: 'POST' });
      setSyncMessage(
        data.data.created > 0
          ? `${data.data.created} model baru ditemukan`
          : 'Katalog sudah terkini',
      );
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal menyinkronkan model');
    } finally {
      setSyncBusy(false);
    }
  }

  function startEdit(model: Model) {
    const rexu = effectiveRexuMultiplier(model);
    setEditingId(model.id);
    setDraftMultiplier(rexu == null ? '' : String(rexu));
    setDraftBankai(model.bankaiMultiplier == null ? '' : String(model.bankaiMultiplier));
    setDraftMinBlock(model.minBlockOverride == null ? '' : String(model.minBlockOverride));
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraftMultiplier('');
    setDraftBankai('');
    setDraftMinBlock('');
  }

  async function toggle(model: Model) {
    setRowBusy(model.id);
    setError(null);
    try {
      const payload: { isEnabled: boolean; multiplier?: number } = {
        isEnabled: !model.enabled,
      };
      if (!model.enabled && model.multiplier == null) {
        const fallback = effectiveRexuMultiplier(model);
        if (fallback != null && fallback > 0) payload.multiplier = fallback;
      }

      await api(`/api/admin/models/${encodeURIComponent(model.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal mengubah status model');
    } finally {
      setRowBusy(null);
    }
  }

  async function save(model: Model) {
    const bankaiMultiplier = draftBankai.trim() === '' ? 0 : Number(draftBankai);
    const multiplier = draftMultiplier.trim() === '' ? bankaiMultiplier : Number(draftMultiplier);
    const minBlockOverride = draftMinBlock.trim() === '' ? null : Number(draftMinBlock);
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      setError('Multiplier Rexu harus lebih besar dari 0');
      return;
    }
    if (!Number.isFinite(bankaiMultiplier) || bankaiMultiplier < 0) {
      setError('Multiplier BankAI tidak boleh negatif');
      return;
    }
    if (minBlockOverride != null && (!Number.isInteger(minBlockOverride) || minBlockOverride < 0)) {
      setError('Min block override harus bilangan bulat 0 atau lebih');
      return;
    }

    setRowBusy(model.id);
    setError(null);
    try {
      await api(`/api/admin/models/${encodeURIComponent(model.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          multiplier,
          bankaiMultiplier,
          minBlockOverride,
          isEnabled: model.enabled,
        }),
      });
      cancelEdit();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal menyimpan model');
    } finally {
      setRowBusy(null);
    }
  }

  function renderEditor(model: Model) {
    const busy = rowBusy === model.id;
    return (
      <div className="flex flex-wrap items-end gap-3 border-l-2 border-oxide bg-ink/5 px-4 py-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Multiplier Rexu</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={draftMultiplier}
            onChange={(event) => setDraftMultiplier(event.target.value)}
            className="min-h-9 w-32 border border-line bg-paper px-2 font-mono text-sm text-ink outline-none focus:border-ink dark:bg-chalk/5"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Multiplier BankAI</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={draftBankai}
            onChange={(event) => setDraftBankai(event.target.value)}
            className="min-h-9 w-32 border border-line bg-paper px-2 font-mono text-sm text-ink outline-none focus:border-ink dark:bg-chalk/5"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Min block override</span>
          <input
            type="number"
            step="1"
            min="0"
            placeholder="Auto (formula)"
            value={draftMinBlock}
            onChange={(event) => setDraftMinBlock(event.target.value)}
            className="min-h-9 w-40 border border-line bg-paper px-2 font-mono text-sm text-ink outline-none focus:border-ink dark:bg-chalk/5"
          />
          <span className="text-xs text-muted">
            Auto: {tokenFormatter.format(formulaMinBlock(model))} token (2048 × multiplier)
          </span>
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void save(model)}
            disabled={busy}
            className="border border-oxide bg-oxide px-3 py-1.5 text-xs font-medium text-chalk disabled:opacity-60"
          >
            {busy ? 'Menyimpan...' : 'Simpan'}
          </button>
          <button
            type="button"
            onClick={cancelEdit}
            disabled={busy}
            className="border border-line px-3 py-1.5 text-xs text-muted disabled:opacity-60"
          >
            Batal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-[-0.04em]">Model</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            Kelola model yang tersedia untuk pengguna.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void sync()}
          disabled={syncBusy}
          className="border border-line bg-chalk px-3 py-2 text-sm font-medium text-ink transition-colors duration-150 hover:border-ink disabled:opacity-60 dark:bg-chalk/5"
        >
          {syncBusy ? 'Menyinkronkan...' : 'Sinkronisasi'}
        </button>
      </div>

      {syncMessage ? (
        <p className="mt-4 border-l-2 border-petrol pl-3 text-xs text-petrol">{syncMessage}</p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 border-l-2 border-oxide pl-3 text-xs text-oxide">
          {error}
        </p>
      ) : null}

      {models == null ? (
        <p className="border-t border-line py-10 text-center text-sm text-muted">Memuat model…</p>
      ) : models.length === 0 ? (
        <p className="border-t border-line py-10 text-center text-sm text-muted">
          Belum ada model. Jalankan sinkronisasi.
        </p>
      ) : (
        <>
          <div className="mt-6 hidden overflow-x-auto border border-line bg-chalk md:block dark:bg-chalk/5">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Nama
                  </th>
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    ID
                  </th>
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Multiplier BankAI
                  </th>
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Multiplier Rexu
                  </th>
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Status
                  </th>
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Aksi
                  </th>
                </tr>
              </thead>
              <tbody>
                {models.map((model) => (
                  <Fragment key={model.id}>
                    <tr className="border-b border-line align-middle last:border-b-0">
                      <td className="px-3 py-3 font-medium">{model.displayName}</td>
                      <td className="px-3 py-3">
                        <span className="font-mono text-xs text-muted" title={model.id}>
                          {model.id}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-mono text-sm">
                        {formatMultiplier(model.bankaiMultiplier)}
                      </td>
                      <td className="px-3 py-3 font-mono text-sm">
                        {formatMultiplier(effectiveRexuMultiplier(model))}
                        {model.multiplier == null && model.bankaiMultiplier != null ? (
                          <span className="mt-0.5 block font-sans text-[10px] text-muted">
                            dari BankAI
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge enabled={model.enabled} />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            onClick={() => void toggle(model)}
                            disabled={rowBusy === model.id}
                            className={`text-xs disabled:opacity-60 ${
                              model.enabled ? 'text-muted' : 'text-petrol'
                            }`}
                          >
                            {model.enabled ? 'Nonaktifkan' : 'Aktifkan'}
                          </button>
                          <button
                            type="button"
                            onClick={() => startEdit(model)}
                            className="text-xs text-muted hover:text-ink"
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                    {editingId === model.id ? (
                      <tr className="border-b border-line last:border-b-0">
                        <td colSpan={6}>{renderEditor(model)}</td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 space-y-3 md:hidden">
            {models.map((model) => (
              <div key={model.id} className="border border-line bg-chalk p-4 dark:bg-chalk/5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{model.displayName}</p>
                    <p className="mt-1 truncate font-mono text-xs text-muted" title={model.id}>
                      {model.id}
                    </p>
                  </div>
                  <StatusBadge enabled={model.enabled} />
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-2">
                  <div>
                    <dt className="text-xs text-muted">Multiplier BankAI</dt>
                    <dd className="mt-0.5 font-mono text-sm">
                      {formatMultiplier(model.bankaiMultiplier)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Multiplier Rexu</dt>
                    <dd className="mt-0.5 font-mono text-sm">
                      {formatMultiplier(effectiveRexuMultiplier(model))}
                      {model.multiplier == null && model.bankaiMultiplier != null ? (
                        <span className="mt-0.5 block font-sans text-[10px] text-muted">
                          dari BankAI
                        </span>
                      ) : null}
                    </dd>
                  </div>
                </dl>

                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
                  <button
                    type="button"
                    onClick={() => void toggle(model)}
                    disabled={rowBusy === model.id}
                    className={`text-xs disabled:opacity-60 ${
                      model.enabled ? 'text-muted' : 'text-petrol'
                    }`}
                  >
                    {model.enabled ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(model)}
                    className="text-xs text-muted hover:text-ink"
                  >
                    Edit
                  </button>
                </div>

                {editingId === model.id ? <div className="mt-3">{renderEditor(model)}</div> : null}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
