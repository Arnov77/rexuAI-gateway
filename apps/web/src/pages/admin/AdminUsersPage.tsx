import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { formatDate, formatNumber } from '../../lib/format';
import type { AdminUser } from '../../lib/types';

const PAGE_SIZE = 20;

type UsersResponse = {
  data: AdminUser[];
  meta?: { page: number; limit: number; total: number; totalRc: string };
};

const joinedFormatter = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

function RoleBadge({ role }: { role: AdminUser['role'] }) {
  return (
    <span
      className={`inline-block border px-2 py-0.5 text-[10px] font-medium ${
        role === 'admin'
          ? 'border-oxide/20 bg-oxide/10 text-oxide'
          : 'border-muted/20 bg-muted/10 text-muted'
      }`}
    >
      {role === 'admin' ? 'Admin' : 'Customer'}
    </span>
  );
}

function Balance({ user }: { user: AdminUser }) {
  const total = Number(user.wallet.totalRc);
  const remaining = Number(user.wallet.remainingRc);
  const low = total > 0 && remaining < total * 0.1;

  return (
    <span className={`font-mono text-sm tnum ${low ? 'text-oxide' : ''}`}>
      {formatNumber(user.wallet.remainingRc)} / {formatNumber(user.wallet.totalRc)}
    </span>
  );
}

export function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [total, setTotal] = useState(0);
  const [totalRc, setTotalRc] = useState('0');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [adjustment, setAdjustment] = useState('');
  const [note, setNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (debouncedSearch) params.set('search', debouncedSearch);
      const data = await api<UsersResponse>(`/api/admin/users?${params.toString()}`);
      setUsers(data.data);
      setTotal(data.meta?.total ?? data.data.length);
      setTotalRc(data.meta?.totalRc ?? '0');
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal memuat pengguna');
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  useEffect(() => {
    if (page > totalPages && users != null) setPage(totalPages);
  }, [page, totalPages, users]);

  function togglePanel(user: AdminUser) {
    if (expandedId === user.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(user.id);
    setAdjustment('');
    setNote('');
    setSuccess(null);
    setError(null);
  }

  async function applyQuota(event: FormEvent, user: AdminUser) {
    event.preventDefault();
    const value = Number(adjustment);
    if (!Number.isInteger(value) || value === 0) {
      setError('Adjustment harus bilangan bulat dan tidak sama dengan 0');
      return;
    }

    setBusyId(user.id);
    setError(null);
    setSuccess(null);
    try {
      await api(`/api/admin/users/${user.id}/quota`, {
        method: 'POST',
        body: JSON.stringify({
          adjustment: value,
          note: note.trim() || undefined,
        }),
      });
      setAdjustment('');
      setNote('');
      setSuccess(`Saldo RC ${user.name} berhasil diperbarui.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal menyesuaikan RC');
    } finally {
      setBusyId(null);
    }
  }

  function renderManagePanel(user: AdminUser) {
    const busy = busyId === user.id;
    return (
      <div className="border-t border-line bg-ink/5 px-4 py-4">
        <div className="grid gap-5 md:grid-cols-2">
          <form onSubmit={(event) => void applyQuota(event, user)}>
            <p className="text-sm font-medium">Tambah / Kurangi RC</p>
            <label className="mt-3 block">
              <span className="text-xs text-muted">Jumlah RC</span>
              <input
                type="number"
                step="1"
                required
                value={adjustment}
                onChange={(event) => setAdjustment(event.target.value)}
                placeholder="contoh: 1000 atau -500"
                className="mt-1 block min-h-9 w-full border border-line bg-paper px-2 font-mono text-sm text-ink outline-none focus:border-ink dark:bg-chalk/5"
              />
            </label>
            <label className="mt-3 block">
              <span className="text-xs text-muted">Catatan (opsional)</span>
              <input
                type="text"
                maxLength={500}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="alasan penyesuaian"
                className="mt-1 block min-h-9 w-full border border-line bg-paper px-2 text-sm text-ink outline-none placeholder:text-muted focus:border-ink dark:bg-chalk/5"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="mt-3 border border-oxide bg-oxide px-3 py-1.5 text-xs font-medium text-chalk disabled:opacity-60"
            >
              {busy ? 'Menerapkan...' : 'Terapkan'}
            </button>
          </form>

          <div>
            <p className="text-sm font-medium">Info wallet</p>
            <dl className="mt-3 grid grid-cols-2 gap-3 font-mono text-sm">
              <div>
                <dt className="text-xs text-muted">Total RC</dt>
                <dd className="mt-0.5 tnum">{formatNumber(user.wallet.totalRc)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Used RC</dt>
                <dd className="mt-0.5 tnum">{formatNumber(user.wallet.usedRc)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Reserved RC</dt>
                <dd className="mt-0.5 tnum">{formatNumber(user.wallet.reservedRc)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Expires At</dt>
                <dd className="mt-0.5 text-xs">
                  {user.wallet.expiresAt ? formatDate(user.wallet.expiresAt) : '—'}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-12">
      <header className="border-b border-line pb-6">
        <h1 className="text-3xl font-bold tracking-[-0.04em]">Pengguna</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
          Kelola akun dan saldo RC pengguna.
        </p>
      </header>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <label className="w-full max-w-sm">
          <span className="sr-only">Cari pengguna</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cari nama atau email..."
            className="block min-h-10 w-full border border-line bg-paper px-3 text-sm text-ink outline-none placeholder:text-muted focus:border-ink dark:bg-chalk/5"
          />
        </label>
        <p className="font-mono text-xs text-muted">
          {users == null
            ? 'Memuat…'
            : `${formatNumber(total)} pengguna · ${formatNumber(totalRc)} RC beredar`}
        </p>
      </div>

      {success ? (
        <p className="mt-4 border-l-2 border-petrol pl-3 text-xs text-petrol">{success}</p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 border-l-2 border-oxide pl-3 text-xs text-oxide">
          {error}
        </p>
      ) : null}

      {users == null || (loading && users.length === 0) ? (
        <p className="border-t border-line py-10 text-center text-sm text-muted">
          Memuat pengguna…
        </p>
      ) : users.length === 0 ? (
        <p className="border-t border-line py-10 text-center text-sm text-muted">
          Tidak ada pengguna yang cocok.
        </p>
      ) : (
        <>
          <div className="mt-4 hidden overflow-x-auto border border-line bg-chalk md:block dark:bg-chalk/5">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Nama
                  </th>
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Email
                  </th>
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Role
                  </th>
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Saldo RC
                  </th>
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Bergabung
                  </th>
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                    Aksi
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <UserRows
                    key={user.id}
                    user={user}
                    expanded={expandedId === user.id}
                    onToggle={() => togglePanel(user)}
                    panel={renderManagePanel(user)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 space-y-3 md:hidden">
            {users.map((user) => (
              <div key={user.id} className="border border-line bg-chalk dark:bg-chalk/5">
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{user.name}</p>
                      <p className="mt-1 truncate font-mono text-xs text-muted">{user.email}</p>
                    </div>
                    <RoleBadge role={user.role} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <Balance user={user} />
                    <span className="font-mono text-xs text-muted">
                      {joinedFormatter.format(new Date(user.createdAt))}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => togglePanel(user)}
                    className="mt-3 border border-line px-2 py-1 text-xs text-muted transition-colors duration-150 hover:border-ink hover:text-ink"
                  >
                    {expandedId === user.id ? 'Tutup' : 'Kelola'}
                  </button>
                </div>
                {expandedId === user.id ? renderManagePanel(user) : null}
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-xs text-muted">
              Halaman {currentPage} dari {totalPages}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage(Math.max(1, currentPage - 1))}
                disabled={currentPage <= 1 || loading}
                className="border border-line bg-chalk px-3 py-1 text-sm transition-colors duration-150 hover:border-ink disabled:text-muted disabled:opacity-40 dark:bg-chalk/5"
              >
                Sebelumnya
              </button>
              <button
                type="button"
                onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage >= totalPages || loading}
                className="border border-line bg-chalk px-3 py-1 text-sm transition-colors duration-150 hover:border-ink disabled:text-muted disabled:opacity-40 dark:bg-chalk/5"
              >
                Berikutnya
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function UserRows({
  user,
  expanded,
  onToggle,
  panel,
}: {
  user: AdminUser;
  expanded: boolean;
  onToggle: () => void;
  panel: ReactNode;
}) {
  return (
    <>
      <tr className="border-b border-line align-middle">
        <td className="px-3 py-3 font-medium">{user.name}</td>
        <td className="px-3 py-3">
          <span className="font-mono text-xs text-muted">{user.email}</span>
        </td>
        <td className="px-3 py-3">
          <RoleBadge role={user.role} />
        </td>
        <td className="px-3 py-3">
          <Balance user={user} />
        </td>
        <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-muted">
          {joinedFormatter.format(new Date(user.createdAt))}
        </td>
        <td className="px-3 py-3">
          <button
            type="button"
            onClick={onToggle}
            className="border border-line px-2 py-1 text-xs text-muted transition-colors duration-150 hover:border-ink hover:text-ink"
          >
            {expanded ? 'Tutup' : 'Kelola'}
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-line last:border-b-0">
          <td colSpan={6}>{panel}</td>
        </tr>
      ) : null}
    </>
  );
}
