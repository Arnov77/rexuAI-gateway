import { Fragment, useCallback, useEffect, useState } from 'react';
import { ConfirmModal } from '../../components/ConfirmModal';
import { api } from '../../lib/api';
import { formatNumber } from '../../lib/format';
import type { AdminRcPackage } from '../../lib/types';

const rateFormatter = new Intl.NumberFormat('id-ID', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatRate(priceIdr: number, rcAmount: number): string {
  if (!Number.isFinite(priceIdr) || !Number.isFinite(rcAmount) || priceIdr <= 0) return '—';
  return `${rateFormatter.format(rcAmount / priceIdr)} RC/Rp`;
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-block border px-2 py-0.5 text-[10px] font-medium ${
        active
          ? 'border-petrol/20 bg-petrol/10 text-petrol'
          : 'border-muted/20 bg-muted/10 text-muted'
      }`}
    >
      {active ? 'Aktif' : 'Nonaktif'}
    </span>
  );
}

export function AdminPackagesPage() {
  const [packages, setPackages] = useState<AdminRcPackage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftPrice, setDraftPrice] = useState('');
  const [draftRc, setDraftRc] = useState('');

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addPrice, setAddPrice] = useState('');
  const [addRc, setAddRc] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<AdminRcPackage | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ data: AdminRcPackage[] }>('/api/admin/packages');
      setPackages(data.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal memuat paket');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function resetAddForm() {
    setAddName('');
    setAddPrice('');
    setAddRc('');
    setAddError(null);
  }

  function startEdit(pkg: AdminRcPackage) {
    setEditingId(pkg.id);
    setDraftName(pkg.name);
    setDraftPrice(String(pkg.priceIdr));
    setDraftRc(String(pkg.rcAmount));
    setError(null);
    setNotice(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraftName('');
    setDraftPrice('');
    setDraftRc('');
  }

  async function submitAdd() {
    const name = addName.trim();
    const priceIdr = Number(addPrice);
    const rcAmount = Number(addRc);

    if (!name) {
      setAddError('Nama paket wajib diisi');
      return;
    }
    if (!Number.isInteger(priceIdr) || priceIdr < 1) {
      setAddError('Harga harus bilangan bulat minimal Rp 1');
      return;
    }
    if (!Number.isInteger(rcAmount) || rcAmount < 1) {
      setAddError('RC amount harus bilangan bulat minimal 1');
      return;
    }

    setAddBusy(true);
    setAddError(null);
    try {
      await api('/api/admin/packages', {
        method: 'POST',
        body: JSON.stringify({ name, priceIdr, rcAmount }),
      });
      setAddOpen(false);
      resetAddForm();
      setNotice('Paket ditambahkan');
      await load();
    } catch (caught) {
      setAddError(caught instanceof Error ? caught.message : 'Gagal menambah paket');
    } finally {
      setAddBusy(false);
    }
  }

  async function saveEdit(pkg: AdminRcPackage) {
    const name = draftName.trim();
    const priceIdr = Number(draftPrice);
    const rcAmount = Number(draftRc);

    if (!name) {
      setError('Nama paket wajib diisi');
      return;
    }
    if (!Number.isInteger(priceIdr) || priceIdr < 1) {
      setError('Harga harus bilangan bulat minimal Rp 1');
      return;
    }
    if (!Number.isInteger(rcAmount) || rcAmount < 1) {
      setError('RC amount harus bilangan bulat minimal 1');
      return;
    }

    setRowBusy(pkg.id);
    setError(null);
    setNotice(null);
    try {
      await api(`/api/admin/packages/${encodeURIComponent(pkg.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, priceIdr, rcAmount }),
      });
      cancelEdit();
      setNotice('Paket diperbarui');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal menyimpan paket');
    } finally {
      setRowBusy(null);
    }
  }

  async function toggle(pkg: AdminRcPackage) {
    setRowBusy(pkg.id);
    setError(null);
    setNotice(null);
    try {
      await api(`/api/admin/packages/${encodeURIComponent(pkg.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !pkg.isActive }),
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal mengubah status paket');
    } finally {
      setRowBusy(null);
    }
  }

  async function removePackage() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/api/admin/packages/${encodeURIComponent(deleteTarget.id)}`, {
        method: 'DELETE',
      });
      setDeleteTarget(null);
      setNotice('Paket dihapus');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal menghapus paket');
    } finally {
      setDeleteBusy(false);
    }
  }

  const draftPriceNumber = Number(draftPrice);
  const draftRcNumber = Number(draftRc);
  const addPriceNumber = Number(addPrice);
  const addRcNumber = Number(addRc);

  function renderEditor(pkg: AdminRcPackage) {
    const busy = rowBusy === pkg.id;
    return (
      <div className="flex flex-wrap items-end gap-3 border-l-2 border-oxide bg-ink/5 px-4 py-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Nama</span>
          <input
            type="text"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            className="min-h-9 w-40 border border-line bg-paper px-2 text-sm text-ink outline-none focus:border-ink dark:bg-chalk/5"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Harga (Rp)</span>
          <input
            type="number"
            min="1"
            step="1"
            value={draftPrice}
            onChange={(event) => setDraftPrice(event.target.value)}
            className="min-h-9 w-32 border border-line bg-paper px-2 font-mono text-sm text-ink outline-none focus:border-ink dark:bg-chalk/5"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">RC amount</span>
          <input
            type="number"
            min="1"
            step="1"
            value={draftRc}
            onChange={(event) => setDraftRc(event.target.value)}
            className="min-h-9 w-36 border border-line bg-paper px-2 font-mono text-sm text-ink outline-none focus:border-ink dark:bg-chalk/5"
          />
        </label>
        <p className="font-mono text-xs text-muted">
          = {formatRate(draftPriceNumber, draftRcNumber)}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void saveEdit(pkg)}
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
          <h1 className="text-3xl font-bold tracking-[-0.04em]">Paket RC</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            Kelola paket yang tampil di halaman Top Up.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            resetAddForm();
            setAddOpen(true);
          }}
          className="border border-line bg-chalk px-3 py-2 text-sm font-medium text-ink transition-colors duration-150 hover:border-ink dark:bg-chalk/5"
        >
          Tambah paket
        </button>
      </div>

      {notice ? (
        <p className="mt-4 border-l-2 border-petrol pl-3 text-xs text-petrol">{notice}</p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 border-l-2 border-oxide pl-3 text-xs text-oxide">
          {error}
        </p>
      ) : null}

      {packages == null ? (
        <p className="border-t border-line py-10 text-center text-sm text-muted">Memuat paket…</p>
      ) : packages.length === 0 ? (
        <p className="border-t border-line py-10 text-center text-sm text-muted">
          Belum ada paket. Tambahkan paket pertama.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto border border-line bg-chalk dark:bg-chalk/5">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Nama
                </th>
                <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Harga
                </th>
                <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  RC
                </th>
                <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Rate
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
              {packages.map((pkg) => (
                <Fragment key={pkg.id}>
                  <tr className="border-b border-line align-middle last:border-b-0">
                    <td className="px-3 py-3 font-medium">{pkg.name}</td>
                    <td className="px-3 py-3 font-mono text-sm">Rp {formatNumber(pkg.priceIdr)}</td>
                    <td className="px-3 py-3 font-mono text-sm">{formatNumber(pkg.rcAmount)}</td>
                    <td className="px-3 py-3 font-mono text-xs text-muted">
                      {formatRate(pkg.priceIdr, pkg.rcAmount)}
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge active={pkg.isActive} />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => void toggle(pkg)}
                          disabled={rowBusy === pkg.id}
                          className={`text-xs disabled:opacity-60 ${
                            pkg.isActive ? 'text-muted' : 'text-petrol'
                          }`}
                        >
                          {pkg.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(pkg)}
                          className="text-xs text-muted hover:text-ink"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(pkg)}
                          disabled={rowBusy === pkg.id}
                          className="text-xs text-oxide disabled:opacity-60"
                        >
                          Hapus
                        </button>
                      </div>
                    </td>
                  </tr>
                  {editingId === pkg.id ? (
                    <tr className="border-b border-line last:border-b-0">
                      <td colSpan={6}>{renderEditor(pkg)}</td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmModal
        isOpen={addOpen}
        title="Tambah paket"
        confirmLabel="Simpan"
        onConfirm={() => void submitAdd()}
        onCancel={() => {
          setAddOpen(false);
          resetAddForm();
        }}
        loading={addBusy}
        error={addError}
      >
        <div className="space-y-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Nama paket</span>
            <input
              type="text"
              value={addName}
              onChange={(event) => setAddName(event.target.value)}
              placeholder="Starter"
              className="min-h-9 border border-line bg-paper px-2 text-sm text-ink outline-none focus:border-ink dark:bg-chalk/5"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Harga (Rp)</span>
            <input
              type="number"
              min="1"
              step="1"
              value={addPrice}
              onChange={(event) => setAddPrice(event.target.value)}
              placeholder="2000"
              className="min-h-9 border border-line bg-paper px-2 font-mono text-sm text-ink outline-none focus:border-ink dark:bg-chalk/5"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">RC amount</span>
            <input
              type="number"
              min="1"
              step="1"
              value={addRc}
              onChange={(event) => setAddRc(event.target.value)}
              placeholder="6500"
              className="min-h-9 border border-line bg-paper px-2 font-mono text-sm text-ink outline-none focus:border-ink dark:bg-chalk/5"
            />
          </label>
          <p className="font-mono text-xs text-muted">
            = {formatRate(addPriceNumber, addRcNumber)}
          </p>
        </div>
      </ConfirmModal>

      {deleteTarget ? (
        <ConfirmModal
          isOpen
          title="Hapus paket?"
          description={`Paket "${deleteTarget.name}" akan dinonaktifkan dan tidak tampil di halaman topup.`}
          confirmLabel="Hapus"
          onConfirm={() => void removePackage()}
          onCancel={() => setDeleteTarget(null)}
          loading={deleteBusy}
        />
      ) : null}
    </div>
  );
}
