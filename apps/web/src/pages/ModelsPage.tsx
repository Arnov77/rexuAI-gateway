import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Model } from '../lib/types';

type Filter = 'all' | 'vision' | 'text';

const filters: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'Semua' },
  { value: 'vision', label: 'Vision' },
  { value: 'text', label: 'Teks saja' },
];

const rcFormatter = new Intl.NumberFormat('id-ID');

function formatRcPerMtok(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${rcFormatter.format(value)} RC/1M`;
}

export function ModelsPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await api<{ data: Model[] }>('/api/user/models');
        setModels(data.data);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Gagal memuat model');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const filtered = models.filter((model) => {
    if (filter === 'vision') return model.vision;
    if (filter === 'text') return !model.vision;
    return true;
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <h1 className="text-3xl font-bold tracking-[-0.04em]">Model tersedia</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            Model yang tersedia untuk Playground dan API.
          </p>
          <p className="mt-1 text-xs text-muted">Harga per 1 juta token.</p>
        </div>
        <p className="font-mono text-xs text-muted">{filtered.length} model</p>
      </div>

      {error ? (
        <p role="alert" className="mt-6 border-l-2 border-oxide pl-3 text-sm text-oxide">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-8 text-sm text-muted">Memuat katalog</p>
      ) : models.length === 0 ? (
        <div className="mt-8 border-t border-line pt-6">
          <h2 className="text-lg font-semibold">Belum ada model tersedia</h2>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">
            Hubungi admin untuk mengaktifkan model.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 inline-flex border border-line bg-chalk dark:bg-chalk/5">
            {filters.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setFilter(item.value)}
                aria-pressed={filter === item.value}
                className={`border-r border-line px-3 py-1.5 text-sm last:border-r-0 ${
                  filter === item.value
                    ? 'bg-ink text-paper'
                    : 'text-muted hover:bg-ink/5 hover:text-ink'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <p className="mt-6 border-t border-line py-8 text-sm text-muted">
              Tidak ada model untuk filter ini.
            </p>
          ) : (
            <ul className="mt-6 divide-y divide-line border border-line bg-chalk dark:bg-chalk/5">
              {filtered.map((model) => (
                <li key={model.id} className="px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-medium">{model.displayName}</h2>
                      <p className="font-mono text-xs text-muted">
                        {model.rcPerMtok == null ? '-' : `[${formatRcPerMtok(model.rcPerMtok)}]`}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {model.vision ? (
                        <span className="border border-line px-1.5 py-0.5 text-[11px] text-ink">
                          Vision
                        </span>
                      ) : null}
                      <span className="border border-line px-1.5 py-0.5 text-[11px] text-ink">
                        Teks
                      </span>
                    </div>
                  </div>
                  <div className="mt-2">
                    <span
                      className={`inline-block px-2 py-0.5 text-[10px] font-medium ${
                        model.available ? 'bg-petrol/10 text-petrol' : 'bg-muted/10 text-muted'
                      }`}
                    >
                      {model.available ? 'Tersedia' : 'Tidak tersedia'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
