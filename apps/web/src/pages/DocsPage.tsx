import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PublicNav, scrollToSection } from '../components/PublicNav';
import { Wordmark } from '../components/Wordmark';

const BASE_URL = 'https://rexu.ai.id/v1';

const navLinks = [
  { href: '#mulai', label: 'Mulai' },
  { href: '#chat', label: 'Chat' },
  { href: '#models', label: 'Model' },
  { href: '#integrasi', label: 'Integrasi' },
];

const sections = [
  { id: 'mulai', label: 'Quick Start' },
  { id: 'autentikasi', label: 'Autentikasi' },
  { id: 'chat', label: 'Chat Completions' },
  { id: 'streaming', label: 'Streaming' },
  { id: 'models', label: 'Daftar Model' },
  { id: 'error', label: 'Error' },
  { id: 'integrasi', label: 'Integrasi AI Tools' },
];

const facts = [
  { label: 'Base URL', value: BASE_URL },
  { label: 'Format', value: 'OpenAI-compatible' },
  { label: 'Autentikasi', value: 'Bearer API key' },
];

const steps: Array<{ title: string; body: ReactNode }> = [
  {
    title: 'Buat akun',
    body: (
      <>
        Daftar di{' '}
        <a
          href="https://rexu.ai.id"
          className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
        >
          rexu.ai.id
        </a>
        , lalu masuk ke dashboard.
      </>
    ),
  },
  {
    title: 'Buat API key',
    body: (
      <>
        Buka menu{' '}
        <Link
          to="/app/keys"
          className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
        >
          API Key
        </Link>{' '}
        dan buat key baru. Raw key hanya tampil sekali.
      </>
    ),
  },
  {
    title: 'Top up RC',
    body: (
      <>
        Isi saldo RC lewat QRIS di menu{' '}
        <Link
          to="/app/topup"
          className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
        >
          Top up
        </Link>
        .
      </>
    ),
  },
  {
    title: 'Panggil API',
    body: <>Kirim request pertama dengan contoh cURL di bawah.</>,
  },
];

const quickStartCurl = `curl https://rexu.ai.id/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-rxu-..." \\
  -d '{
    "model": "deepseek-v4.1-flash",
    "messages": [
      {"role": "user", "content": "Halo!"}
    ]
  }'`;

const authHeader = `Authorization: Bearer sk-rxu-...`;

const chatPython = `from openai import OpenAI

client = OpenAI(
    base_url="https://rexu.ai.id/v1",
    api_key="sk-rxu-...",
)

response = client.chat.completions.create(
    model="deepseek-v4.1-flash",
    messages=[{"role": "user", "content": "Halo!"}],
)

print(response.choices[0].message.content)`;

const chatNode = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://rexu.ai.id/v1",
  apiKey: "sk-rxu-...",
});

const response = await client.chat.completions.create({
  model: "deepseek-v4.1-flash",
  messages: [{ role: "user", content: "Halo!" }],
});

console.log(response.choices[0].message.content);`;

const chatResponse = `{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "model": "deepseek-v4.1-flash",
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "Halo! Ada yang bisa saya bantu?"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 12,
    "total_tokens": 22
  }
}`;

const streamPython = `stream = client.chat.completions.create(
    model="deepseek-v4.1-flash",
    messages=[{"role": "user", "content": "Ceritakan sesuatu."}],
    stream=True,
)

for chunk in stream:
    delta = chunk.choices[0].delta.content
    if delta:
        print(delta, end="", flush=True)`;

const modelsResponse = `{
  "object": "list",
  "data": [
    {
      "id": "deepseek-v4.1-flash",
      "object": "model",
      "vision": true,
      "streaming": true
    }
  ]
}`;

const errorResponse = `{
  "error": {
    "message": "Pesan error",
    "code": "kode_error",
    "request_id": "req-..."
  }
}`;

const openCodeConfig = `[providers.rexu]
type = "openai-compatible"
base_url = "https://rexu.ai.id/v1"
api_key = "sk-rxu-..."

[model]
provider = "rexu"
model = "deepseek-v4.1-flash"`;

const aiderCommand = `aider --openai-api-base https://rexu.ai.id/v1 \\
      --openai-api-key sk-rxu-... \\
      --model deepseek-v4.1-flash`;

const litellmConfig = `model = "openai/deepseek-v4.1-flash"
api_base = "https://rexu.ai.id/v1"
api_key = "sk-rxu-..."`;

function Mono({ children }: { children: ReactNode }) {
  return (
    <code className="border border-line bg-chalk px-1 py-0.5 font-mono text-[0.8em] break-all dark:bg-chalk/5">
      {children}
    </code>
  );
}

function handleAnchorClick(event: MouseEvent<HTMLAnchorElement>, id: string) {
  event.preventDefault();
  scrollToSection(id);
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }

    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="border border-[#3a3a36] px-2 py-0.5 font-mono text-[10px] text-[#c8c3b6] transition-colors duration-150 hover:border-[#c8c3b6] hover:text-[#f0ede6]"
    >
      {copied ? 'Tersalin' : 'Salin'}
    </button>
  );
}

function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <div className="min-w-0 overflow-hidden border border-line bg-[#1a1a18]">
      <div className="flex items-center justify-between gap-4 border-b border-[#333330] bg-[#141412] px-4 py-2.5">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="size-3 rounded-full bg-[#c0392b]" />
          <span className="size-3 rounded-full bg-[#d4ac0d]" />
          <span className="size-3 rounded-full bg-[#27ae60]" />
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-muted">{label}</span>
          <CopyButton text={code} />
        </div>
      </div>
      <pre className="max-w-full overflow-x-auto px-4 py-4 font-mono text-[13px] leading-6 text-[#f0ede6]/90">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Endpoint({ method, path }: { method: 'GET' | 'POST'; path: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border border-line bg-chalk px-3 py-2 dark:bg-chalk/5">
      <span
        className={`px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-chalk ${
          method === 'POST' ? 'bg-oxide' : 'bg-petrol'
        }`}
      >
        {method}
      </span>
      <code className="font-mono text-sm break-all">{path}</code>
    </div>
  );
}

function DataTable({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto border border-line">
      <table className="w-full min-w-[540px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line font-mono text-[10px] tracking-wider text-muted uppercase">
            {head.map((label) => (
              <th key={label} className="px-3 py-2 font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="align-top">{children}</tbody>
      </table>
    </div>
  );
}

function TableRow({ children }: { children: ReactNode }) {
  return <tr className="border-b border-line last:border-b-0">{children}</tr>;
}

function Cell({ children, mono = false }: { children: ReactNode; mono?: boolean }) {
  return (
    <td className={`px-3 py-2.5 ${mono ? 'font-mono text-xs' : 'text-sm'} leading-relaxed`}>
      {children}
    </td>
  );
}

function DocSection({
  id,
  number,
  title,
  intro,
  children,
}: {
  id: string;
  number: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-32 border-t border-line py-10 first:border-t-0 first:pt-0 lg:scroll-mt-20"
    >
      <p className="font-mono text-[10px] tracking-[0.18em] text-muted uppercase">{number}</p>
      <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] sm:text-3xl">{title}</h2>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">{intro}</p>
      <div className="mt-6 space-y-5">{children}</div>
    </section>
  );
}

function TableOfContents() {
  return (
    <nav aria-label="Daftar isi">
      <p className="font-mono text-[10px] tracking-[0.18em] text-muted uppercase">Di halaman ini</p>
      <ol className="mt-4 border-t border-line">
        {sections.map((section, index) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              onClick={(event) => handleAnchorClick(event, section.id)}
              className="flex min-h-10 items-center gap-3 border-b border-line text-sm text-muted transition-colors duration-150 hover:text-ink"
            >
              <span className="font-mono text-[10px] text-muted">
                {String(index + 1).padStart(2, '0')}
              </span>
              {section.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function DocsPage() {
  return (
    <div className="min-h-dvh bg-paper text-ink">
      <PublicNav links={navLinks} showLogin />

      <main>
        <section className="border-b border-line">
          <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
            <p className="font-mono text-xs tracking-[0.18em] text-oxide uppercase">
              Dokumentasi API
            </p>
            <h1 className="mt-4 max-w-3xl text-4xl leading-[0.95] font-extrabold tracking-[-0.055em] text-ink sm:text-6xl">
              Panduan integrasi.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
              Rexu memakai format OpenAI. Ganti base URL dan API key, lalu panggil endpoint seperti
              biasa.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link
                to="/app/keys"
                className="inline-flex min-h-12 items-center justify-center border border-oxide bg-oxide px-5 text-sm font-semibold text-chalk transition-colors duration-150 hover:border-petrol hover:bg-petrol"
              >
                Buat API key
              </Link>
              <button
                type="button"
                onClick={() => scrollToSection('mulai')}
                className="inline-flex min-h-12 items-center justify-center border border-line px-5 text-sm font-semibold text-ink transition-colors duration-150 hover:border-ink"
              >
                Mulai cepat
              </button>
            </div>

            <dl className="mt-10 grid gap-px border border-line bg-line sm:grid-cols-3">
              {facts.map((fact) => (
                <div key={fact.label} className="bg-paper px-4 py-4">
                  <dt className="font-mono text-[10px] tracking-[0.16em] text-muted uppercase">
                    {fact.label}
                  </dt>
                  <dd className="mt-1.5 font-mono text-xs break-all sm:text-sm">{fact.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <div className="sticky top-16 z-30 border-b border-line bg-paper lg:hidden">
          <nav
            aria-label="Daftar isi"
            className="mx-auto flex w-full max-w-6xl gap-5 overflow-x-auto px-4 py-2 sm:px-6"
          >
            {sections.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                onClick={(event) => handleAnchorClick(event, section.id)}
                className="shrink-0 py-1 font-mono text-xs whitespace-nowrap text-muted transition-colors duration-150 hover:text-ink"
              >
                {section.label}
              </a>
            ))}
          </nav>
        </div>

        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-14">
            <aside className="hidden lg:block">
              <div className="sticky top-16 max-h-[calc(100dvh-4rem)] overflow-y-auto py-10">
                <TableOfContents />
              </div>
            </aside>

            <div className="min-w-0 py-10">
              <DocSection
                id="mulai"
                number="01"
                title="Quick Start"
                intro="Empat langkah untuk mengirim request pertama."
              >
                <ol className="grid gap-px border border-line bg-line sm:grid-cols-2">
                  {steps.map((step, index) => (
                    <li key={step.title} className="bg-paper p-4">
                      <span className="font-mono text-[10px] text-oxide">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <h3 className="mt-2 text-sm font-semibold">{step.title}</h3>
                      <p className="mt-1.5 text-xs leading-relaxed text-muted">{step.body}</p>
                    </li>
                  ))}
                </ol>

                <CodeBlock label="cURL" code={quickStartCurl} />
              </DocSection>

              <DocSection
                id="autentikasi"
                number="02"
                title="Autentikasi"
                intro="Semua request ke /v1 membutuhkan API key."
              >
                <CodeBlock label="Header" code={authHeader} />

                <ul className="space-y-3 text-sm leading-relaxed text-muted">
                  <li className="border-l-2 border-line pl-3">
                    Buat API key di dashboard, lalu simpan karena raw key hanya tampil sekali.
                  </li>
                  <li className="border-l-2 border-line pl-3">
                    Jangan menaruh API key di frontend atau repo publik.
                  </li>
                </ul>
              </DocSection>

              <DocSection
                id="chat"
                number="03"
                title="Chat Completions"
                intro="Endpoint utama untuk membuat completion dari daftar pesan."
              >
                <Endpoint method="POST" path="/v1/chat/completions" />

                <DataTable head={['Field', 'Tipe', 'Wajib', 'Catatan']}>
                  <TableRow>
                    <Cell mono>model</Cell>
                    <Cell mono>string</Cell>
                    <Cell>Ya</Cell>
                    <Cell>ID model dari GET /v1/models.</Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>messages</Cell>
                    <Cell mono>array</Cell>
                    <Cell>Ya</Cell>
                    <Cell>Array pesan (role: user/assistant/system).</Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>stream</Cell>
                    <Cell mono>boolean</Cell>
                    <Cell>Tidak</Cell>
                    <Cell>
                      Default <Mono>false</Mono>.
                    </Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>max_tokens</Cell>
                    <Cell mono>integer</Cell>
                    <Cell>Tidak</Cell>
                    <Cell>Batas panjang output.</Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>temperature</Cell>
                    <Cell mono>number</Cell>
                    <Cell>Tidak</Cell>
                    <Cell>Kreativitas jawaban (0–2).</Cell>
                  </TableRow>
                </DataTable>

                <h3 className="text-sm font-semibold">Python</h3>
                <CodeBlock label="Python" code={chatPython} />

                <h3 className="text-sm font-semibold">Node.js</h3>
                <CodeBlock label="Node.js" code={chatNode} />

                <h3 className="text-sm font-semibold">Response</h3>
                <CodeBlock label="JSON" code={chatResponse} />
              </DocSection>

              <DocSection
                id="streaming"
                number="04"
                title="Streaming"
                intro="Aktifkan dengan stream: true. Format SSE dan kompatibel dengan OpenAI SDK."
              >
                <CodeBlock label="Python" code={streamPython} />
              </DocSection>

              <DocSection
                id="models"
                number="05"
                title="Daftar Model"
                intro="Kembalikan daftar model yang tersedia."
              >
                <Endpoint method="GET" path="/v1/models" />

                <CodeBlock label="JSON" code={modelsResponse} />

                <p className="text-sm leading-relaxed text-muted">
                  Gunakan field <Mono>id</Mono> sebagai nilai <Mono>model</Mono> di chat
                  completions. Lihat{' '}
                  <Link
                    to="/app/models"
                    className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
                  >
                    halaman Model
                  </Link>{' '}
                  di dashboard untuk info lengkap setiap model.
                </p>
              </DocSection>

              <DocSection id="error" number="06" title="Error" intro="Kode error yang paling umum.">
                <DataTable head={['Status', 'Keterangan']}>
                  <TableRow>
                    <Cell mono>400</Cell>
                    <Cell>Model tidak tersedia atau request tidak valid.</Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>401</Cell>
                    <Cell>API key salah atau tidak aktif.</Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>429</Cell>
                    <Cell>Terlalu banyak request atau saldo RC habis.</Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>5xx</Cell>
                    <Cell>Masalah sementara di server, coba lagi.</Cell>
                  </TableRow>
                </DataTable>

                <CodeBlock label="JSON" code={errorResponse} />

                <p className="text-sm leading-relaxed text-muted">
                  Sertakan <Mono>request_id</Mono> saat menghubungi support.
                </p>
              </DocSection>

              <DocSection
                id="integrasi"
                number="07"
                title="Integrasi AI Tools"
                intro="Rexu kompatibel dengan semua tool yang mendukung custom OpenAI endpoint."
              >
                <h3 className="text-sm font-semibold">OpenCode</h3>
                <p className="text-sm leading-relaxed text-muted">
                  Tambahkan provider berikut ke konfigurasi, lalu pilih modelnya.
                </p>
                <CodeBlock label="TOML" code={openCodeConfig} />

                <h3 className="text-sm font-semibold">Cursor</h3>
                <ul className="space-y-2 text-sm leading-relaxed text-muted">
                  <li>Settings → Models → Add Model.</li>
                  <li>
                    Base URL: <Mono>https://rexu.ai.id/v1</Mono>
                  </li>
                  <li>
                    API Key: <Mono>sk-rxu-...</Mono>
                  </li>
                  <li>
                    Model: <Mono>deepseek-v4.1-flash</Mono> atau model lain.
                  </li>
                </ul>

                <h3 className="text-sm font-semibold">Cline / Roo Code (VS Code)</h3>
                <ul className="space-y-2 text-sm leading-relaxed text-muted">
                  <li>Settings → API Provider → OpenAI Compatible.</li>
                  <li>
                    Base URL: <Mono>https://rexu.ai.id/v1</Mono>
                  </li>
                  <li>
                    API Key: <Mono>sk-rxu-...</Mono>
                  </li>
                </ul>

                <h3 className="text-sm font-semibold">Aider</h3>
                <CodeBlock label="Shell" code={aiderCommand} />

                <h3 className="text-sm font-semibold">LiteLLM / 9Router / proxy lain</h3>
                <CodeBlock label="Config" code={litellmConfig} />

                <p className="border-l-2 border-petrol pl-3 text-sm leading-relaxed text-muted">
                  Semua tool yang mendukung OpenAI-compatible endpoint bisa langsung dipakai dengan
                  mengganti base URL dan API key.
                </p>
              </DocSection>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-line bg-paper">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-10 sm:flex-row sm:items-center sm:justify-between md:px-8">
          <Link
            to="/"
            onClick={() => window.scrollTo(0, 0)}
            className="inline-flex min-h-11 items-center"
            aria-label="Rexu, kembali ke beranda"
          >
            <Wordmark />
          </Link>

          <nav className="flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs text-muted">
            <Link to="/" className="transition-colors duration-150 hover:text-ink">
              Beranda
            </Link>
            <Link to="/login" className="transition-colors duration-150 hover:text-ink">
              Masuk
            </Link>
            <Link to="/app/keys" className="transition-colors duration-150 hover:text-ink">
              API key
            </Link>
          </nav>

          <p className="text-xs text-muted">© 2026 Rexu</p>
        </div>
      </footer>
    </div>
  );
}
