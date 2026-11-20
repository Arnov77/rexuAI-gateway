import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PublicNav, scrollToSection } from '../components/PublicNav';
import { Wordmark } from '../components/Wordmark';

const BASE_URL = 'https://rexu.ai.id/v1';

const navLinks = [
  { href: '#mulai', label: 'Mulai' },
  { href: '#chat', label: 'Chat' },
  { href: '#models', label: 'Model' },
  { href: '#error', label: 'Error' },
];

const sections = [
  { id: 'mulai', label: 'Mulai cepat' },
  { id: 'autentikasi', label: 'Autentikasi' },
  { id: 'chat', label: 'Chat completions' },
  { id: 'streaming', label: 'Streaming' },
  { id: 'models', label: 'Daftar model' },
  { id: 'usage', label: 'Pemakaian' },
  { id: 'rc', label: 'RC & billing' },
  { id: 'error', label: 'Rate limit & error' },
];

const facts = [
  { label: 'Base URL', value: BASE_URL },
  { label: 'Format', value: 'OpenAI-compatible' },
  { label: 'Autentikasi', value: 'Bearer sk-rxu-...' },
];

const steps: Array<{ title: string; body: ReactNode }> = [
  {
    title: 'Buat akun',
    body: (
      <>
        Di halaman Masuk, pilih tab Daftar. Isi email dan password minimal 8 karakter, lalu masukkan
        OTP 6 digit yang dikirim ke email.
      </>
    ),
  },
  {
    title: 'Buat API key',
    body: (
      <>
        Buka menu API key dan buat key baru. Raw key hanya ditampilkan sekali, jadi simpan di tempat
        aman.
      </>
    ),
  },
  {
    title: 'Isi saldo RC',
    body: <>Top up lewat QRIS. Minimum Rp 2.000 dan RC tidak kedaluwarsa selama akun aktif.</>,
  },
  {
    title: 'Panggil API',
    body: (
      <>
        Arahkan SDK ke <Mono>{BASE_URL}</Mono> dan kirim API key lewat header Authorization.
      </>
    ),
  },
];

const quickStartCurl = `curl ${BASE_URL}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-rxu-..." \\
  -d '{
    "model": "deepseek-v4.1-flash",
    "messages": [
      {"role": "user", "content": "Halo, kenalan dulu."}
    ]
  }'`;

const authHeader = `Authorization: Bearer sk-rxu-...
Content-Type: application/json`;

const chatPython = `from openai import OpenAI

client = OpenAI(
    base_url="${BASE_URL}",
    api_key="sk-rxu-...",
)

response = client.chat.completions.create(
    model="deepseek-v4.1-flash",
    messages=[
        {"role": "system", "content": "Jawab singkat dalam bahasa Indonesia."},
        {"role": "user", "content": "Apa itu RC?"},
    ],
    temperature=0.7,
)

print(response.choices[0].message.content)`;

const chatResponse = `{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1760000000,
  "model": "deepseek-v4.1-flash",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "RC adalah Rexu Credit, unit billing Rexu."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 38,
    "completion_tokens": 14,
    "total_tokens": 52
  }
}`;

const streamPython = `from openai import OpenAI

client = OpenAI(
    base_url="${BASE_URL}",
    api_key="sk-rxu-...",
)

stream = client.chat.completions.create(
    model="deepseek-v4.1-flash",
    messages=[{"role": "user", "content": "Tulis pantun singkat."}],
    stream=True,
)

for chunk in stream:
    delta = chunk.choices[0].delta.content
    if delta:
        print(delta, end="", flush=True)`;

const streamSse = `data: {"id":"chatcmpl-...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Halo"},"finish_reason":null}]}

data: {"id":"chatcmpl-...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]`;

const modelsResponse = `{
  "object": "list",
  "data": [
    {
      "id": "deepseek-v4.1-flash",
      "object": "model",
      "created": 1760000000,
      "owned_by": "bankai",
      "vision": true,
      "streaming": true,
      "rexu": {
        "displayName": "DeepSeek V4.1 Flash",
        "multiplier": 1.2,
        "multiplierBp": 12000,
        "vision": true,
        "streaming": true
      }
    }
  ]
}`;

const usageResponse = `{
  "object": "usage",
  "key": {
    "id": "8f14e45f-ea3b-4f0e-9c1a-2b7d6f1c9a01",
    "name": "produksi"
  },
  "period": {
    "from": "2026-11-01T00:00:00.000Z",
    "to": null
  },
  "totals": {
    "requests": 128,
    "rawTokens": 402130,
    "rcDeducted": 5400
  },
  "by_model": [
    {
      "model": "deepseek-v4.1-flash",
      "requests": 120,
      "raw_tokens": 380000,
      "rc_deducted": 5100
    }
  ]
}`;

const errorResponse = `{
  "error": {
    "message": "Batas request API key tercapai",
    "type": "rate_limit_error",
    "code": "rate_limited",
    "request_id": "req-..."
  }
}`;

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
      <span className="ml-auto font-mono text-[10px] tracking-wider text-muted">JSON</span>
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

function Note({ children, tone = 'petrol' }: { children: ReactNode; tone?: 'petrol' | 'oxide' }) {
  return (
    <div
      className={`border-l-2 pl-3 text-sm leading-relaxed text-muted ${
        tone === 'oxide' ? 'border-oxide' : 'border-petrol'
      }`}
    >
      {children}
    </div>
  );
}

function SectionHeading({
  number,
  title,
  intro,
}: {
  number: string;
  title: string;
  intro: string;
}) {
  return (
    <>
      <p className="font-mono text-[10px] tracking-[0.18em] text-muted uppercase">{number}</p>
      <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] sm:text-3xl">{title}</h2>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">{intro}</p>
    </>
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
      <SectionHeading number={number} title={title} intro={intro} />
      <div className="mt-6 space-y-5">{children}</div>
    </section>
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
              Satu endpoint.
              <br />
              Semua model.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
              Rexu API memakai format OpenAI. Ganti base URL, pakai API key Rexu, dan kode yang
              sudah ada tetap berjalan.
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
                title="Mulai cepat"
                intro="Empat langkah dari akun kosong sampai request pertama."
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

                <p className="text-sm leading-relaxed text-muted">
                  Belum punya akun?{' '}
                  <Link
                    to="/login"
                    className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
                  >
                    Daftar atau masuk
                  </Link>
                  . Setelah itu buka{' '}
                  <Link
                    to="/app/keys"
                    className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
                  >
                    menu API key
                  </Link>
                  .
                </p>

                <CodeBlock label="cURL" code={quickStartCurl} />
              </DocSection>

              <DocSection
                id="autentikasi"
                number="02"
                title="Autentikasi"
                intro="Setiap request ke endpoint /v1 memakai API key di header Authorization."
              >
                <CodeBlock label="Header" code={authHeader} />

                <p className="text-sm leading-relaxed text-muted">
                  API key dibuat dari dashboard, berprefix <Mono>sk-rxu-</Mono>, dan hanya
                  ditampilkan sekali saat dibuat. Key yang dicabut atau akun yang tidak aktif
                  langsung ditolak dengan status <Mono>401</Mono>.
                </p>

                <Note>
                  Cookie sesi dashboard tidak dipakai oleh API. Untuk integrasi server-ke-server,
                  cukup kirim Bearer key dari environment variable.
                </Note>

                <Note tone="oxide">
                  Jangan menaruh API key di kode frontend, repo publik, atau aplikasi mobile yang
                  bisa dibongkar. Panggilan API sebaiknya lewat backend kamu.
                </Note>
              </DocSection>

              <DocSection
                id="chat"
                number="03"
                title="Chat completions"
                intro="Endpoint utama untuk membuat completion dari daftar pesan."
              >
                <Endpoint method="POST" path="/v1/chat/completions" />

                <DataTable head={['Field', 'Tipe', 'Wajib', 'Catatan']}>
                  <TableRow>
                    <Cell mono>model</Cell>
                    <Cell mono>string</Cell>
                    <Cell>Ya</Cell>
                    <Cell>
                      ID model dari <Mono>GET /v1/models</Mono>.
                    </Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>messages</Cell>
                    <Cell mono>array</Cell>
                    <Cell>Ya</Cell>
                    <Cell>
                      1–256 pesan. Role yang didukung: <Mono>system</Mono>, <Mono>user</Mono>,{' '}
                      <Mono>assistant</Mono>, <Mono>tool</Mono>.
                    </Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>stream</Cell>
                    <Cell mono>boolean</Cell>
                    <Cell>Tidak</Cell>
                    <Cell>
                      Default <Mono>false</Mono>. Lihat bagian Streaming.
                    </Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>max_tokens</Cell>
                    <Cell mono>integer</Cell>
                    <Cell>Tidak</Cell>
                    <Cell>Batas panjang output. Bisa juga memakai max_completion_tokens.</Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>temperature</Cell>
                    <Cell mono>number</Cell>
                    <Cell>Tidak</Cell>
                    <Cell>Kreativitas jawaban, diteruskan ke model.</Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>field OpenAI lain</Cell>
                    <Cell mono>—</Cell>
                    <Cell>Tidak</Cell>
                    <Cell>Diteruskan ke upstream selama didukung model.</Cell>
                  </TableRow>
                </DataTable>

                <p className="text-sm leading-relaxed text-muted">
                  <Mono>content</Mono> bisa berupa teks sampai 200.000 karakter, atau array part
                  untuk model vision. Contoh part gambar mengikuti format OpenAI.
                </p>

                <h3 className="text-sm font-semibold">Contoh request</h3>
                <CodeBlock label="Python" code={chatPython} />

                <h3 className="text-sm font-semibold">Contoh respons</h3>
                <CodeBlock label="JSON" code={chatResponse} />

                <h3 className="text-sm font-semibold">Header respons</h3>
                <ul className="space-y-2 text-sm leading-relaxed text-muted">
                  <li>
                    <Mono>x-quota-remaining</Mono> — saldo RC yang tersedia saat request diterima.
                  </li>
                  <li>
                    <Mono>x-rexu-usage-log-id</Mono> — ID log pemakaian untuk request ini.
                  </li>
                  <li>
                    <Mono>x-upstream-request-id</Mono> — ID request dari penyedia model, jika ada.
                  </li>
                </ul>

                <Note>
                  Untuk retry yang aman, kirim header <Mono>Idempotency-Key</Mono>. Jika key yang
                  sama sudah dipakai, request ditolak dengan status <Mono>409</Mono> dan kode{' '}
                  <Mono>duplicate_request</Mono>.
                </Note>
              </DocSection>

              <DocSection
                id="streaming"
                number="04"
                title="Streaming"
                intro="Aktifkan stream untuk menerima potongan jawaban saat dibuat, bukan menunggu respons selesai."
              >
                <p className="text-sm leading-relaxed text-muted">
                  Set <Mono>stream: true</Mono> pada body request. Respons memakai format
                  Server-Sent Events: setiap baris <Mono>data:</Mono> berisi satu chunk JSON, lalu
                  diakhiri <Mono>data: [DONE]</Mono>.
                </p>

                <CodeBlock label="Python" code={streamPython} />

                <h3 className="text-sm font-semibold">Bentuk stream mentah</h3>
                <CodeBlock label="SSE" code={streamSse} />

                <p className="text-sm leading-relaxed text-muted">
                  Header <Mono>x-rexu-request-id</Mono>, <Mono>x-rexu-usage-log-id</Mono>, dan{' '}
                  <Mono>x-quota-remaining</Mono> dikirim sebelum chunk pertama. Sebagian model juga
                  mengirim <Mono>usage</Mono> di chunk terakhir; nilai itu yang dipakai untuk
                  billing.
                </p>

                <Note tone="oxide">
                  Jika koneksi terputus di tengah stream, request tetap tercatat di usage log.
                  Sebagian stream yang belum mengirim usage akan ditandai untuk rekonsiliasi.
                </Note>
              </DocSection>

              <DocSection
                id="models"
                number="05"
                title="Daftar model"
                intro="Ambil daftar model yang aktif beserta kemampuan dan pengali harganya."
              >
                <Endpoint method="GET" path="/v1/models" />

                <CodeBlock label="JSON" code={modelsResponse} />

                <DataTable head={['Field', 'Arti']}>
                  <TableRow>
                    <Cell mono>id</Cell>
                    <Cell>ID yang dipakai di field model saat memanggil chat completions.</Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>owned_by</Cell>
                    <Cell>Penyedia upstream model.</Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>vision</Cell>
                    <Cell>Model menerima input gambar.</Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>streaming</Cell>
                    <Cell>Model mendukung respons stream.</Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>rexu.multiplierBp</Cell>
                    <Cell>
                      Pengali harga dalam basis poin. <Mono>10000</Mono> berarti 1×.
                    </Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>rexu.multiplier</Cell>
                    <Cell>Nilai desimal dari multiplierBp, misalnya 1.2 untuk 12000 bp.</Cell>
                  </TableRow>
                </DataTable>

                <Note>
                  Nilai pada contoh di atas hanya ilustrasi. Selalu baca multiplier dari respons API
                  karena harga tiap model bisa berubah.
                </Note>
              </DocSection>

              <DocSection
                id="usage"
                number="06"
                title="Pemakaian"
                intro="Lihat total request, token mentah, dan RC yang terpotong untuk satu API key."
              >
                <Endpoint method="GET" path="/v1/usage?from=2026-11-01&to=2026-11-30" />

                <DataTable head={['Query', 'Format', 'Catatan']}>
                  <TableRow>
                    <Cell mono>from</Cell>
                    <Cell mono>ISO 8601</Cell>
                    <Cell>Opsional. Batas awal, inklusif.</Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>to</Cell>
                    <Cell mono>ISO 8601</Cell>
                    <Cell>Opsional. Batas akhir, inklusif.</Cell>
                  </TableRow>
                </DataTable>

                <p className="text-sm leading-relaxed text-muted">
                  Tanpa query, hasil menghitung seluruh pemakaian key tersebut. Hanya trafik yang
                  memakai API key ini yang dihitung.
                </p>

                <CodeBlock label="JSON" code={usageResponse} />

                <p className="text-sm leading-relaxed text-muted">
                  <Mono>raw_tokens</Mono> adalah token mentah dari upstream, sedangkan{' '}
                  <Mono>rc_deducted</Mono> adalah RC yang benar-benar dipotong. Perhatikan bahwa
                  totals memakai camelCase (<Mono>rawTokens</Mono>, <Mono>rcDeducted</Mono>),
                  sementara <Mono>by_model</Mono> memakai snake_case.
                </p>
              </DocSection>

              <DocSection
                id="rc"
                number="07"
                title="RC & billing"
                intro="RC adalah unit saldo Rexu. Setiap request AI memotong RC sesuai model dan token yang dipakai."
              >
                <ul className="space-y-3 text-sm leading-relaxed text-muted">
                  <li className="border-l-2 border-line pl-3">
                    Besaran potongan mengikuti token mentah dan multiplier model. Nilai{' '}
                    <Mono>rexu.multiplierBp</Mono> di <Mono>GET /v1/models</Mono> menunjukkan
                    pengali harga relatif.
                  </li>
                  <li className="border-l-2 border-line pl-3">
                    Nilai akhir per request selalu bisa dicek di <Mono>GET /v1/usage</Mono> lewat
                    field <Mono>rc_deducted</Mono>.
                  </li>
                  <li className="border-l-2 border-line pl-3">
                    <Mono>x-quota-remaining</Mono> menunjukkan saldo tersedia saat request diterima,
                    bukan saldo setelah request selesai.
                  </li>
                  <li className="border-l-2 border-line pl-3">
                    Isi saldo lewat QRIS di{' '}
                    <Link
                      to="/app/topup"
                      className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
                    >
                      halaman Top up
                    </Link>
                    . Minimum Rp 2.000. RC tidak kedaluwarsa selama akun aktif.
                  </li>
                </ul>

                <div className="flex flex-wrap gap-3">
                  <Link
                    to="/app/topup"
                    className="inline-flex min-h-11 items-center justify-center border border-line px-4 text-sm font-semibold text-ink transition-colors duration-150 hover:border-ink"
                  >
                    Isi saldo RC
                  </Link>
                  <Link
                    to="/app/usage"
                    className="inline-flex min-h-11 items-center justify-center border border-line px-4 text-sm font-semibold text-ink transition-colors duration-150 hover:border-ink"
                  >
                    Lihat usage log
                  </Link>
                </div>
              </DocSection>

              <DocSection
                id="error"
                number="08"
                title="Rate limit & error"
                intro="Semua error memakai bentuk JSON yang sama, lengkap dengan kode dan request ID."
              >
                <p className="text-sm leading-relaxed text-muted">
                  Default rate limit adalah 60 request per menit untuk setiap API key. Saat limit
                  tercapai, respons <Mono>429</Mono> menyertakan header <Mono>Retry-After</Mono>{' '}
                  dalam detik.
                </p>

                <CodeBlock label="JSON" code={errorResponse} />

                <DataTable head={['Status', 'Code', 'Arti']}>
                  <TableRow>
                    <Cell mono>400</Cell>
                    <Cell mono>validation_failed</Cell>
                    <Cell>Body request tidak sesuai skema.</Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>400</Cell>
                    <Cell mono>model_unavailable</Cell>
                    <Cell>Model tidak ada atau sedang tidak tersedia.</Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>400</Cell>
                    <Cell mono>request_too_large</Cell>
                    <Cell>Estimasi request melebihi batas reservasi RC.</Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>401</Cell>
                    <Cell mono>unauthorized</Cell>
                    <Cell>API key hilang, salah, atau sudah dicabut.</Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>409</Cell>
                    <Cell mono>duplicate_request</Cell>
                    <Cell>Idempotency-Key yang sama sudah dipakai.</Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>413</Cell>
                    <Cell mono>payload_too_large</Cell>
                    <Cell>Body request terlalu besar.</Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>429</Cell>
                    <Cell mono>rate_limited</Cell>
                    <Cell>Batas request per menit tercapai. Cek Retry-After.</Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>429</Cell>
                    <Cell mono>insufficient_quota</Cell>
                    <Cell>Saldo RC tidak cukup atau batas kredit API key tercapai.</Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>502–504</Cell>
                    <Cell mono>model_unavailable / timeout</Cell>
                    <Cell>Upstream gagal atau timeout. Coba lagi dengan backoff.</Cell>
                  </TableRow>
                  <TableRow>
                    <Cell mono>500</Cell>
                    <Cell mono>internal_error</Cell>
                    <Cell>Kesalahan internal Rexu.</Cell>
                  </TableRow>
                </DataTable>

                <Note>
                  Sertakan <Mono>request_id</Mono> saat melapor. Untuk 429, tunggu sesuai{' '}
                  <Mono>Retry-After</Mono>. Untuk 5xx, retry dengan exponential backoff.
                </Note>
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
