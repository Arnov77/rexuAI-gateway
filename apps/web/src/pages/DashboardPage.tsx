import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthProvider';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';
import type { ApiKey, Model, UsageLog } from '../lib/types';
import { loadUsageLogs } from '../lib/usage';

const dateFormatter = new Intl.DateTimeFormat('id-ID', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function greetingFor(hour: number): string {
  if (hour >= 5 && hour <= 11) return 'Selamat pagi';
  if (hour >= 12 && hour <= 14) return 'Selamat siang';
  if (hour >= 15 && hour <= 17) return 'Selamat sore';
  return 'Selamat malam';
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function relativeTime(value: string): string {
  const date = new Date(value);
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} menit lalu`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  if (hours < 48) return 'kemarin';

  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="border border-line bg-chalk p-4 dark:bg-chalk/5">
      <p className="font-mono text-xs text-muted">{label}</p>
      <p className="mt-2 font-mono text-2xl font-bold tnum">{value}</p>
      <p className="mt-1 text-xs text-muted">{sub}</p>
    </div>
  );
}

export function DashboardPage() {
  const { user, wallet } = useAuth();
  const navigate = useNavigate();
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [logs, setLogs] = useState<UsageLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [keysResult, usageResult, modelsResult] = await Promise.allSettled([
        api<{ data: ApiKey[] }>('/api/user/keys'),
        loadUsageLogs(),
        api<{ data: Model[] }>('/api/user/models'),
      ]);

      if (cancelled) return;

      if (keysResult.status === 'fulfilled') setKeys(keysResult.value.data);
      if (usageResult.status === 'fulfilled') setLogs(usageResult.value);
      if (modelsResult.status === 'fulfilled') setModels(modelsResult.value.data);

      if ([keysResult, usageResult, modelsResult].some((result) => result.status === 'rejected')) {
        setError('Sebagian data gagal dimuat.');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const now = new Date();
  const greeting = greetingFor(now.getHours());
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const activeKeys = keys == null ? null : keys.filter((key) => key.status === 'active').length;
  const totalRequests = logs?.length ?? null;
  const todayRequests =
    logs == null ? null : logs.filter((log) => new Date(log.createdAt) >= startOfToday).length;

  const recent: UsageLog[] = [];
  const seenModels = new Set<string>();
  for (const log of logs ?? []) {
    if (seenModels.has(log.modelId)) continue;
    seenModels.add(log.modelId);
    recent.push(log);
    if (recent.length === 3) break;
  }

  const displayName = (modelId: string) =>
    models.find((model) => model.id === modelId)?.displayName ?? modelId;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-12">
      <header className="border-b border-line pb-6">
        <h1 className="text-3xl font-bold tracking-[-0.04em] sm:text-4xl">
          {greeting}, {user?.name}.
        </h1>
        <p className="mt-2 text-sm text-muted">{dateFormatter.format(now)}</p>
      </header>

      {error ? (
        <p role="alert" className="mt-4 border-l-2 border-oxide pl-3 text-xs text-oxide">
          {error}
        </p>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Saldo RC"
          value={wallet ? formatNumber(wallet.remainingRc) : '—'}
          sub={`dari ${wallet ? formatNumber(wallet.totalRc) : '—'} RC total`}
        />
        <StatCard
          label="API Key Aktif"
          value={activeKeys == null ? '—' : formatNumber(activeKeys)}
          sub="key terdaftar"
        />
        <StatCard
          label="Total Request"
          value={totalRequests == null ? '—' : formatNumber(totalRequests)}
          sub="sepanjang waktu"
        />
        <StatCard
          label="Request Hari Ini"
          value={todayRequests == null ? '—' : formatNumber(todayRequests)}
          sub="dalam 24 jam terakhir"
        />
      </div>

      <section className="mt-6 border border-line bg-chalk p-4 dark:bg-chalk/5">
        <h2 className="mb-3 text-sm font-medium">Aksi cepat</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => navigate('/app/playground')}
            className="inline-flex min-h-10 items-center justify-center border border-oxide bg-oxide px-4 text-sm font-semibold tracking-[-0.01em] text-chalk transition-colors duration-150 hover:border-petrol hover:bg-petrol"
          >
            Buka Playground
          </button>
          <button
            type="button"
            onClick={() => navigate('/app/keys')}
            className="inline-flex min-h-10 items-center justify-center border border-line bg-transparent px-4 text-sm font-semibold tracking-[-0.01em] text-ink transition-colors duration-150 hover:border-ink hover:bg-paper dark:hover:bg-chalk/5"
          >
            Buat API Key
          </button>
        </div>
      </section>

      <h2 className="mb-3 mt-6 text-sm font-medium">Terakhir dipakai</h2>
      {logs == null ? (
        <p className="py-4 text-sm text-muted">Memuat aktivitas…</p>
      ) : recent.length === 0 ? (
        <p className="border-t border-line py-4 text-sm text-muted">
          Belum ada aktivitas. Coba Playground untuk memulai.
        </p>
      ) : (
        <ul className="border border-line bg-chalk dark:bg-chalk/5">
          {recent.map((log) => (
            <li
              key={log.modelId}
              className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 last:border-b-0"
            >
              <span className="truncate text-sm">{displayName(log.modelId)}</span>
              <span className="shrink-0 font-mono text-xs text-muted">
                {relativeTime(log.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
