import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import { ConfirmModal } from '../components/ConfirmModal';
import { RawKeyModal } from '../components/RawKeyModal';
import { RegenerateKeyModal } from '../components/RegenerateKeyModal';
import { Button } from '../components/ui/Button';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import type { ApiKey } from '../lib/types';

const CODE_TAB_KEY = 'rexu-code-tab';

const pythonCode = `from openai import OpenAI

client = OpenAI(
    base_url="https://rexu.ai.id/v1",
    api_key="sk-rxu-..."
)`;

const nodeCode = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://rexu.ai.id/v1",
  apiKey: "sk-rxu-..."
});`;

const curlCode = `curl https://rexu.ai.id/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-rxu-..." \\
  -d '{
    "model": "deepseek-v4.1-flash",
    "messages": [
      {"role": "user", "content": "Halo!"}
    ]
  }'`;

type CodeTab = 'python' | 'node' | 'curl';

const codeSamples: Record<CodeTab, string> = {
  python: pythonCode,
  node: nodeCode,
  curl: curlCode,
};

const codePatterns: Record<CodeTab, RegExp> = {
  python: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(#[^\n]*)|\b(from|import)\b/g,
  node: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(#[^\n]*)|\b(import|from|const|new)\b/g,
  curl: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(#[^\n]*)|\b(curl)\b|(-[Hd]\b)|(https?:\/\/[^\s"'\\]+)/g,
};

const STRING_COLOR = 'text-[#4a9e8e]';

function highlight(code: string, tab: CodeTab): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  for (const match of code.matchAll(codePatterns[tab])) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(code.slice(cursor, index));

    const className = match[1]
      ? STRING_COLOR
      : match[2]
        ? 'text-muted'
        : match[3]
          ? 'text-oxide'
          : STRING_COLOR;

    nodes.push(
      <span key={key} className={className}>
        {match[0]}
      </span>,
    );
    key += 1;
    cursor = index + match[0].length;
  }

  if (cursor < code.length) nodes.push(code.slice(cursor));
  return nodes;
}

function isCodeTab(value: string | null): value is CodeTab {
  return value === 'python' || value === 'node' || value === 'curl';
}

function keyLabel(key: ApiKey): string {
  return `${key.keyPrefix}...${key.lastFour}`;
}

function StatusBadge({ status }: { status: ApiKey['status'] }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 text-[10px] font-medium ${
        status === 'active' ? 'bg-petrol/10 text-petrol' : 'bg-muted/10 text-muted'
      }`}
    >
      {status === 'active' ? 'Aktif' : 'Dicabut'}
    </span>
  );
}

export function KeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [regenerateTarget, setRegenerateTarget] = useState<ApiKey | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [codeTab, setCodeTab] = useState<CodeTab>(() => {
    const stored = window.localStorage.getItem(CODE_TAB_KEY);
    return isCodeTab(stored) ? stored : 'python';
  });

  const load = useCallback(async () => {
    try {
      const data = await api<{ data: ApiKey[] }>('/api/user/keys');
      setKeys(data.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal memuat API key');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ key: string }>('/api/user/keys', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      });
      setName('');
      setError(null);
      setCreatedKey(data.key);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal membuat API key');
    } finally {
      setBusy(false);
    }
  }

  function askRevoke(key: ApiKey) {
    setError(null);
    setRevokeError(null);
    setRevokeTarget(key);
  }

  async function revoke() {
    if (!revokeTarget) return;
    setRevokeBusy(true);
    setRevokeError(null);
    try {
      await api(`/api/user/keys/${revokeTarget.id}`, { method: 'DELETE' });
      await load();
      setRevokeTarget(null);
    } catch (caught) {
      setRevokeError(caught instanceof Error ? caught.message : 'Gagal mencabut API key');
    } finally {
      setRevokeBusy(false);
    }
  }

  function openRegenerate(key: ApiKey) {
    setError(null);
    setRegenerateTarget(key);
  }

  function selectCodeTab(tab: CodeTab) {
    setCodeTab(tab);
    window.localStorage.setItem(CODE_TAB_KEY, tab);
  }

  return (
    <div className="mx-auto max-w-5xl overflow-x-hidden px-4 py-8 sm:px-6 lg:py-12">
      <div className="border-b border-line pb-5">
        <h1 className="text-3xl font-bold tracking-[-0.04em]">API key</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
          Pakai key ini untuk memanggil API OpenAI-compatible Rexu. Raw key hanya tampil sekali.
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0">
          {error ? (
            <p role="alert" className="mb-4 border-l-2 border-oxide pl-3 text-sm text-oxide">
              {error}
            </p>
          ) : null}

          {keys.length === 0 ? (
            <div className="border-t border-line pt-5">
              <h2 className="text-lg font-semibold">Belum ada key</h2>
              <p className="mt-2 text-sm text-muted">Buat key pertama untuk mulai memanggil API.</p>
            </div>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {keys.map((key) => (
                  <div
                    key={key.id}
                    className="w-full border border-line bg-chalk p-4 dark:bg-chalk/5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 overflow-hidden">
                        <p className="font-medium break-words">{key.name}</p>
                        <p className="mt-1 font-mono text-xs break-all text-muted">
                          {keyLabel(key)}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          Dibuat {formatDate(key.createdAt)}
                        </p>
                      </div>
                      <StatusBadge status={key.status} />
                    </div>
                    {key.status === 'active' ? (
                      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openRegenerate(key)}
                          className="border border-line px-2 py-1 text-xs text-muted transition-colors duration-150 hover:border-ink hover:text-ink"
                        >
                          Regenerate
                        </button>
                        <button
                          type="button"
                          onClick={() => askRevoke(key)}
                          className="text-xs text-oxide hover:underline"
                        >
                          Cabut
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="hidden overflow-x-auto border border-line bg-chalk dark:bg-chalk/5 md:block">
                <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs text-muted">
                      <th className="py-2 pr-4 pl-4 font-medium">Nama</th>
                      <th className="py-2 pr-4 font-medium">Key</th>
                      <th className="py-2 pr-4 font-medium">Dibuat</th>
                      <th className="py-2 pr-4 font-medium">Status</th>
                      <th className="py-2 pr-4 font-medium">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((key) => (
                      <tr
                        key={key.id}
                        className="border-b border-line align-middle last:border-b-0"
                      >
                        <td className="py-4 pr-4 pl-4 font-medium break-words">{key.name}</td>
                        <td className="py-4 pr-4">
                          <div className="min-w-0 overflow-hidden font-mono text-xs break-all text-muted">
                            {keyLabel(key)}
                          </div>
                        </td>
                        <td className="py-4 pr-4 text-xs text-muted">
                          {formatDate(key.createdAt)}
                        </td>
                        <td className="py-4 pr-4">
                          <StatusBadge status={key.status} />
                        </td>
                        <td className="py-4 pr-4">
                          {key.status === 'active' ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => openRegenerate(key)}
                                className="border border-line px-2 py-1 text-xs text-muted transition-colors duration-150 hover:border-ink hover:text-ink"
                              >
                                Regenerate
                              </button>
                              <button
                                type="button"
                                onClick={() => askRevoke(key)}
                                className="text-xs text-oxide hover:underline"
                              >
                                Cabut
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="mt-8 border-t border-line pt-5">
            <h2 className="text-sm font-semibold">Contoh integrasi</h2>
            <div className="mt-3 min-w-0 overflow-hidden rounded-none border border-line bg-[#1a1a18]">
              <div className="flex items-center justify-between gap-4 bg-[#141412] px-4 py-2.5">
                <div className="flex items-center gap-1.5" aria-hidden="true">
                  <span className="size-3 rounded-full bg-[#c0392b]" />
                  <span className="size-3 rounded-full bg-[#d4ac0d]" />
                  <span className="size-3 rounded-full bg-[#27ae60]" />
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => selectCodeTab('python')}
                    aria-pressed={codeTab === 'python'}
                    className={`px-2 py-0.5 font-mono text-xs transition-colors duration-150 ${
                      codeTab === 'python' ? 'text-[#f0ede6]' : 'text-muted hover:text-[#f0ede6]'
                    }`}
                  >
                    Python
                  </button>
                  <button
                    type="button"
                    onClick={() => selectCodeTab('node')}
                    aria-pressed={codeTab === 'node'}
                    className={`px-2 py-0.5 font-mono text-xs transition-colors duration-150 ${
                      codeTab === 'node' ? 'text-[#f0ede6]' : 'text-muted hover:text-[#f0ede6]'
                    }`}
                  >
                    Node.js
                  </button>
                  <button
                    type="button"
                    onClick={() => selectCodeTab('curl')}
                    aria-pressed={codeTab === 'curl'}
                    className={`px-2 py-0.5 font-mono text-xs transition-colors duration-150 ${
                      codeTab === 'curl' ? 'text-[#f0ede6]' : 'text-muted hover:text-[#f0ede6]'
                    }`}
                  >
                    cURL
                  </button>
                </div>
              </div>
              <pre className="w-full max-w-full overflow-x-auto px-4 py-4 font-mono text-sm leading-6 text-paper/90 dark:text-[#f0ede6]/90">
                <code>{highlight(codeSamples[codeTab], codeTab)}</code>
              </pre>
            </div>
          </div>
        </section>

        <aside className="min-w-0">
          <form
            onSubmit={create}
            className="w-full border border-line bg-chalk p-5 dark:bg-chalk/5"
          >
            <h2 className="text-sm font-semibold">Buat key baru</h2>
            <label className="mt-4 block">
              <span className="text-xs text-muted">Nama key</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                placeholder="produksi"
                className="mt-1.5 block min-h-10 w-full border border-line bg-paper px-3 text-sm text-ink outline-none placeholder:text-muted focus:border-ink dark:bg-chalk/5"
              />
            </label>
            <Button type="submit" disabled={busy || !name.trim()} className="mt-3 w-full">
              {busy ? 'Membuat' : 'Buat key'}
            </Button>
          </form>
        </aside>
      </div>

      {regenerateTarget ? (
        <RegenerateKeyModal
          apiKey={regenerateTarget}
          onClose={() => setRegenerateTarget(null)}
          onDone={() => {
            setRegenerateTarget(null);
            void load();
          }}
        />
      ) : null}

      <ConfirmModal
        isOpen={revokeTarget !== null}
        title="Cabut API key?"
        description={
          revokeTarget
            ? `Key "${revokeTarget.name}" akan langsung tidak aktif dan tidak bisa digunakan lagi.`
            : undefined
        }
        confirmLabel="Cabut key"
        confirmVariant="danger"
        loading={revokeBusy}
        error={revokeError}
        onConfirm={() => void revoke()}
        onCancel={() => setRevokeTarget(null)}
      />

      <RawKeyModal
        isOpen={createdKey !== null}
        rawKey={createdKey ?? ''}
        onClose={() => setCreatedKey(null)}
      />
    </div>
  );
}
