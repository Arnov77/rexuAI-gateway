import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { formatNumber } from '../../lib/format';
import type { AdminUser, Model } from '../../lib/types';

type UsersResponse = {
  data: AdminUser[];
  meta?: { total: number; totalRc: string };
};

type UsageResponse = { total?: number };

type UpstreamHealthError = 'timeout' | 'no_usage' | 'no_choices' | 'upstream_error';

type UpstreamHealth = {
  status: 'ok' | 'degraded' | 'error';
  latencyMs: number;
  checkedAt: string;
  model: string;
  details: {
    httpStatus: number | null;
    hasUsage: boolean;
    hasChoices: boolean;
    completionTokens: number | null;
  };
  error: UpstreamHealthError | null;
  cached?: boolean;
};

function relativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 5) return 'baru saja';
  if (seconds < 60) return `${seconds} detik lalu`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} menit lalu`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;

  return `${Math.floor(hours / 24)} hari lalu`;
}

function upstreamErrorMessage(health: UpstreamHealth): string {
  switch (health.error) {
    case 'timeout':
      return 'Timeout setelah 10 detik';
    case 'no_usage':
      return 'Response tidak mengandung usage data';
    case 'no_choices':
      return 'Response kosong dari upstream';
    case 'upstream_error':
      return health.details.httpStatus == null
        ? 'Gagal menghubungi BankAI'
        : `HTTP ${health.details.httpStatus} dari BankAI`;
    default:
      return 'Terjadi kesalahan pada upstream';
  }
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-3 animate-spin" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray="40 16"
      />
    </svg>
  );
}

function UpstreamStatusCard({
  health,
  loading,
  error,
  onRefresh,
}: {
  health: UpstreamHealth | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  return (
    <section className="mt-6 border border-line p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Status Upstream</h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 border border-line px-2 py-1 text-xs text-muted transition-colors duration-150 hover:border-ink hover:text-ink disabled:opacity-60"
        >
          {loading ? <Spinner /> : null}
          Cek ulang
        </button>
      </div>

      <div className="mt-3">
        {error ? (
          <p className="text-sm text-muted">{error}</p>
        ) : health == null ? (
          <div className="h-4 w-32 animate-pulse rounded bg-ink/10" aria-hidden="true" />
        ) : health.status === 'ok' ? (
          <div className="flex items-start gap-2">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-green-500" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-petrol">BankAI terhubung</p>
              <p className="mt-0.5 font-mono text-xs text-muted">
                Latensi: {health.latencyMs}ms · Dicek: {relativeTime(health.checkedAt)}
              </p>
            </div>
          </div>
        ) : health.status === 'degraded' ? (
          <div className="flex items-start gap-2">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-yellow-500" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-oxide">BankAI merespons tapi mencurigakan</p>
              <p className="mt-0.5 font-mono text-xs text-muted">
                completion_tokens terlalu rendah — periksa BANKAI_API_KEY
              </p>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-start gap-2">
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-oxide" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-oxide">BankAI tidak terhubung</p>
                <p className="mt-0.5 font-mono text-xs text-muted">
                  {upstreamErrorMessage(health)}
                </p>
              </div>
            </div>
            <div className="mt-3 border border-oxide/30 bg-oxide/5 p-3 text-xs">
              Periksa BANKAI_API_KEY di environment dan restart rexu-api jika perlu.
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

type DashboardStats = {
  users: number | null;
  activeModels: number | null;
  pendingReconcile: number | null;
  totalRc: string | null;
};

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: 'oxide';
}) {
  return (
    <div className="border border-line bg-chalk p-4 dark:bg-chalk/5">
      <p className="font-mono text-xs text-muted">{label}</p>
      <p
        className={`mt-2 font-mono text-2xl font-bold tnum ${tone === 'oxide' ? 'text-oxide' : ''}`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-muted">{sub}</p>
    </div>
  );
}

export function AdminDashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    users: null,
    activeModels: null,
    pendingReconcile: null,
    totalRc: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<UpstreamHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState<string | null>(null);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const data = await api<UpstreamHealth>('/api/admin/health/upstream');
      setHealth(data);
    } catch {
      setHealthError('Gagal mengambil status upstream.');
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [usersResult, modelsResult, usageResult] = await Promise.allSettled([
        api<UsersResponse>('/api/admin/users?limit=1'),
        api<{ data: Model[] }>('/api/admin/models'),
        api<UsageResponse>('/api/admin/usage?status=reconciliation&limit=1'),
      ]);

      if (cancelled) return;

      setStats({
        users:
          usersResult.status === 'fulfilled'
            ? (usersResult.value.meta?.total ?? usersResult.value.data.length)
            : null,
        activeModels:
          modelsResult.status === 'fulfilled'
            ? modelsResult.value.data.filter((model) => model.enabled).length
            : null,
        pendingReconcile:
          usageResult.status === 'fulfilled' ? (usageResult.value.total ?? 0) : null,
        totalRc:
          usersResult.status === 'fulfilled' ? (usersResult.value.meta?.totalRc ?? null) : null,
      });

      if ([usersResult, modelsResult, usageResult].some((result) => result.status === 'rejected')) {
        setError('Sebagian data gagal dimuat.');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const pending = stats.pendingReconcile;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-12">
      <header className="border-b border-line pb-6">
        <p className="font-mono text-xs text-muted">Admin</p>
        <h1 className="mt-2 text-3xl font-bold tracking-[-0.04em]">Panel Admin</h1>
        <p className="mt-2 text-sm text-muted">Ringkasan operasional Rexu.</p>
      </header>

      {error ? (
        <p role="alert" className="mt-4 border-l-2 border-oxide pl-3 text-xs text-oxide">
          {error}
        </p>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Total Pengguna"
          value={stats.users == null ? '—' : formatNumber(stats.users)}
          sub="akun terdaftar"
        />
        <StatCard
          label="Total Model Aktif"
          value={stats.activeModels == null ? '—' : formatNumber(stats.activeModels)}
          sub="siap dipakai"
        />
        <StatCard
          label="Pending Rekonsiliasi"
          value={pending == null ? '—' : formatNumber(pending)}
          sub="request menunggu"
          tone={pending != null && pending > 0 ? 'oxide' : undefined}
        />
        <StatCard
          label="Total RC Beredar"
          value={stats.totalRc == null ? '—' : formatNumber(stats.totalRc)}
          sub="akumulasi total RC"
        />
      </div>

      <UpstreamStatusCard
        health={health}
        loading={healthLoading}
        error={healthError}
        onRefresh={() => void loadHealth()}
      />
    </div>
  );
}
