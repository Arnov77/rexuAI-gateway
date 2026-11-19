import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { formatNumber } from '../lib/format';
import type { UsageLog } from '../lib/types';
import { loadUsageLogs } from '../lib/usage';

const PAGE_SIZE = 20;

const averageFormatter = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function truncateModel(modelId: string): string {
  return modelId.length > 20 ? `${modelId.slice(0, 19)}…` : modelId;
}

function ChevronDown({ className = 'size-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function SummaryCard({
  label,
  value,
  className = '',
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={`border border-line bg-chalk p-4 dark:bg-chalk/5 ${className}`}>
      <p className="font-mono text-xs text-muted">{label}</p>
      <p className="mt-2 font-mono text-2xl font-bold tnum">{value}</p>
    </div>
  );
}

export function UsagePage() {
  const [logs, setLogs] = useState<UsageLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await loadUsageLogs();
        if (!cancelled) setLogs(data);
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : 'Gagal memuat usage log');
        setLogs([]);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const modelOptions = useMemo(
    () => (logs ? [...new Set(logs.map((log) => log.modelId))].sort() : []),
    [logs],
  );

  const filtered = useMemo(
    () => (logs ?? []).filter((log) => model == null || log.modelId === model),
    [logs, model],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const summary = useMemo(() => {
    const all = logs ?? [];
    const totalRc = all.reduce((sum, log) => sum + Number(log.rcDeducted || 0), 0);
    return {
      totalRc,
      totalRequests: all.length,
      averageRc: all.length > 0 ? totalRc / all.length : 0,
    };
  }, [logs]);

  function selectModel(value: string | null) {
    setModel(value);
    setPage(1);
    setOpen(false);
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-12">
      <header className="border-b border-line pb-6">
        <h1 className="text-3xl font-bold tracking-[-0.04em]">Usage Log</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
          Riwayat setiap request — input token, output token, RC terpakai.
        </p>
      </header>

      {error ? (
        <p role="alert" className="mt-4 border-l-2 border-oxide pl-3 text-xs text-oxide">
          {error}
        </p>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <SummaryCard
          label="Total RC terpakai"
          value={logs == null ? '—' : formatNumber(summary.totalRc)}
        />
        <SummaryCard
          label="Total request"
          value={logs == null ? '—' : formatNumber(summary.totalRequests)}
        />
        <SummaryCard
          label="Rata-rata RC / request"
          className="col-span-2 md:col-span-1"
          value={logs == null ? '—' : averageFormatter.format(summary.averageRc)}
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="flex min-h-9 min-w-56 items-center justify-between gap-3 border border-line bg-chalk px-3 text-sm dark:bg-chalk/5"
          >
            <span className="truncate font-mono text-xs">{model ?? 'Semua model'}</span>
            <ChevronDown
              className={`size-4 shrink-0 text-muted transition-transform duration-150 ${
                open ? 'rotate-180' : ''
              }`}
            />
          </button>

          {open ? (
            <>
              <button
                type="button"
                aria-label="Tutup pilihan model"
                tabIndex={-1}
                onClick={() => setOpen(false)}
                className="fixed inset-0 z-10 cursor-default"
              />
              <ul
                aria-label="Filter model"
                className="absolute left-0 top-full z-20 mt-1 max-h-64 w-full min-w-56 overflow-y-auto border border-line bg-chalk backdrop-blur-md dark:bg-chalk/5"
              >
                <li>
                  <button
                    type="button"
                    aria-pressed={model == null}
                    onClick={() => selectModel(null)}
                    className={`block w-full px-3 py-2 text-left text-sm ${
                      model == null
                        ? 'bg-ink/5 font-medium text-ink'
                        : 'text-muted hover:bg-ink/5 hover:text-ink'
                    }`}
                  >
                    Semua model
                  </button>
                </li>
                {modelOptions.map((option) => (
                  <li key={option}>
                    <button
                      type="button"
                      aria-pressed={model === option}
                      onClick={() => selectModel(option)}
                      className={`block w-full truncate px-3 py-2 text-left font-mono text-xs ${
                        model === option
                          ? 'bg-ink/5 font-medium text-ink'
                          : 'text-muted hover:bg-ink/5 hover:text-ink'
                      }`}
                    >
                      {option}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => selectModel(null)}
          disabled={model == null}
          className="border border-line bg-chalk px-3 py-2 text-sm text-muted transition-colors duration-150 hover:border-ink hover:text-ink disabled:opacity-40 dark:bg-chalk/5"
        >
          Reset filter
        </button>
      </div>

      {logs == null ? (
        <p className="border-t border-line py-10 text-center text-sm text-muted">
          Memuat usage log…
        </p>
      ) : error ? null : logs.length === 0 ? (
        <p className="border-t border-line py-10 text-center text-sm text-muted">
          Belum ada request. Coba kirim pesan di Playground.
        </p>
      ) : filtered.length === 0 ? (
        <p className="border-t border-line py-10 text-center text-sm text-muted">
          Tidak ada request untuk model ini.
        </p>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto border border-line bg-chalk dark:bg-chalk/5">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted">
                    Waktu
                  </th>
                  <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted">
                    Model
                  </th>
                  <th className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted">
                    Input
                  </th>
                  <th className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted">
                    Output
                  </th>
                  <th className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-wider text-muted">
                    RC
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((log) => {
                  const rc = Number(log.rcDeducted || 0);
                  return (
                    <tr
                      key={log.id}
                      className="border-b border-line transition-colors duration-150 last:border-b-0 hover:bg-ink/3"
                    >
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">
                        {formatDateTime(log.createdAt)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-xs text-muted" title={log.modelId}>
                          {truncateModel(log.modelId)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tnum">
                        {formatNumber(log.promptTokens)}
                      </td>
                      <td className="px-3 py-2.5 text-right tnum">
                        {formatNumber(log.completionTokens)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-medium">
                        {rc > 0 ? `${formatNumber(rc)} RC` : <span className="text-muted">-</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-xs text-muted">
              Halaman {currentPage} dari {totalPages}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage(Math.max(1, currentPage - 1))}
                disabled={currentPage <= 1}
                className="border border-line bg-chalk px-3 py-1 text-sm transition-colors duration-150 hover:border-ink disabled:text-muted disabled:opacity-40 dark:bg-chalk/5"
              >
                Sebelumnya
              </button>
              <button
                type="button"
                onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage >= totalPages}
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
