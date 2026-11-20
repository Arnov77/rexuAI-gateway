import { type MouseEvent, type ReactNode, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { PublicNav, scrollToSection } from '../components/PublicNav';
import { Wordmark } from '../components/Wordmark';
import { useAuth } from '../features/auth/AuthProvider';
import { formatNumber } from '../lib/format';

type IconProps = {
  className?: string;
};

function IconBase({
  className = 'size-4',
  children,
}: IconProps & {
  children: ReactNode;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function ArrowRight({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </IconBase>
  );
}

function ChevronDown({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <path d="m6 9 6 6 6-6" />
    </IconBase>
  );
}

function Terminal({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <path d="m4 17 6-6-6-6" />
      <path d="M12 19h8" />
    </IconBase>
  );
}

function Code2({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <path d="m16 18 6-6-6-6" />
      <path d="m8 6-6 6 6 6" />
    </IconBase>
  );
}

function BarChart2({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <path d="M18 20V10" />
      <path d="M12 20V4" />
      <path d="M6 20v-6" />
    </IconBase>
  );
}

const navLinks = [
  { href: '#harga', label: 'Harga' },
  { href: '/docs', label: 'Dokumentasi' },
  { href: '#faq', label: 'FAQ' },
];

const workflow = [
  {
    title: 'Playground',
    body: 'Coba model langsung di browser tanpa setup.',
    icon: Terminal,
  },
  {
    title: 'Developer API',
    body: 'Integrasikan ke aplikasi lewat endpoint OpenAI-compatible.',
    icon: Code2,
  },
  {
    title: 'Usage Log',
    body: 'Setiap request tercatat: input token, output token, RC terpakai.',
    icon: BarChart2,
  },
];

const models = [
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'glm-5.3',
  'glm-5.3-flash',
  'kimi-k2.7-code',
  'kimi-k2.8',
  'gpt-6-luna',
  'gpt-6-astra',
  'gemini-4-argon',
  'mimo-v2.6-pro',
  'mimo-v2.6-flash',
  'mimo-v2.5-pro',
];

const plans = [
  { name: 'Starter', priceIdr: 2_000, rcAmount: 6_500, featured: false },
  { name: 'Basic', priceIdr: 5_000, rcAmount: 16_500, featured: false },
  { name: 'Standard', priceIdr: 10_000, rcAmount: 33_500, featured: false },
  { name: 'Plus', priceIdr: 20_000, rcAmount: 67_500, featured: false },
  { name: 'Pro', priceIdr: 50_000, rcAmount: 170_000, featured: true },
  { name: 'Scale', priceIdr: 100_000, rcAmount: 350_000, featured: false },
];

const rateFormatter = new Intl.NumberFormat('id-ID', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatRate(plan: { priceIdr: number; rcAmount: number }): string {
  return rateFormatter.format(plan.rcAmount / plan.priceIdr);
}

const upcomingLinks = ['Status', 'Dukungan', 'Privasi', 'Ketentuan'];

const footerSections = [
  { label: 'Harga', href: '#harga' },
  { label: 'FAQ', href: '#faq' },
];

function handleSectionClick(event: MouseEvent<HTMLAnchorElement>, href: string) {
  if (!href.startsWith('#')) return;
  event.preventDefault();
  scrollToSection(href.slice(1));
}

const faqs = [
  {
    question: 'Apa itu RC?',
    answer:
      'RC (Rexu Credit) adalah unit billing Rexu. Setiap request AI memotong RC dari saldo kamu sesuai model yang dipakai.',
  },
  {
    question: 'Apakah RC bisa kedaluwarsa?',
    answer: 'Tidak. RC tidak kedaluwarsa selama akun kamu aktif.',
  },
  {
    question: 'Apa bedanya Rexu dengan berlangganan layanan AI satu per satu?',
    answer:
      'Rexu memberi akses ke 30+ model dari satu API key dan satu saldo RC. Tidak perlu membuat akun dan mengisi saldo di banyak layanan.',
  },
  {
    question: 'Apakah Rexu compatible dengan OpenAI SDK?',
    answer:
      'Ya. Cukup ganti base_url ke https://rexu.ai.id/v1 dan gunakan API key Rexu. Kode lainnya tidak perlu diubah.',
  },
  {
    question: 'Bagaimana cara mendaftar?',
    answer:
      'Pendaftaran terbuka untuk umum. Buka halaman Masuk, pilih tab Daftar, lalu isi email dan password minimal 8 karakter. Rexu mengirim kode OTP 6 digit ke email kamu; masukkan kode itu untuk mengaktifkan akun. Setelah masuk, buat API key di menu API key lalu isi saldo RC lewat QRIS.',
  },
  {
    question: 'Berapa RC yang dipotong per request?',
    answer:
      'Tergantung model yang dipakai dan panjang percakapan. Setiap request tercatat detail di menu Usage Log — input token, output token, dan RC yang dipotong.',
  },
];

export function LandingPage() {
  const { user, loading } = useAuth();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  if (!loading && user) return <Navigate to="/app" replace />;

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <PublicNav links={navLinks} showLogin />

      <main>
        <section className="mx-auto w-full max-w-6xl px-4 pt-14 pb-16 sm:px-6 sm:pt-20 sm:pb-20 lg:px-8 lg:pt-28 lg:pb-24">
          <h1 className="max-w-4xl text-4xl leading-[0.95] font-extrabold tracking-[-0.055em] text-ink sm:text-6xl lg:text-7xl">
            Satu API key.
            <br />
            Banyak model AI.
          </h1>
          <p className="mt-6 max-w-lg text-base leading-relaxed text-muted sm:text-lg">
            Playground langsung di browser, API compatible dengan OpenAI, dan billing RC yang
            tercatat per request.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link
              to="/login"
              className="inline-flex min-h-12 items-center justify-center gap-2 border border-oxide bg-oxide px-5 text-sm font-semibold text-chalk transition-colors duration-150 hover:border-petrol hover:bg-petrol"
            >
              Mulai pakai
              <ArrowRight className="size-4" />
            </Link>
            <Link
              to="/docs"
              className="inline-flex min-h-12 items-center justify-center border border-line px-5 text-sm font-semibold text-ink transition-colors duration-150 hover:border-ink"
            >
              Lihat dokumentasi
            </Link>
          </div>

          <div id="dokumentasi" className="mt-12 max-w-2xl scroll-mt-20 sm:mt-14">
            <div className="rounded-none border border-line bg-[#1a1a18]">
              <div className="flex items-center justify-between gap-4 bg-[#141412] px-4 py-2.5">
                <div className="flex items-center gap-1.5" aria-hidden="true">
                  <span className="size-3 rounded-full bg-[#c0392b]" />
                  <span className="size-3 rounded-full bg-[#d4ac0d]" />
                  <span className="size-3 rounded-full bg-[#27ae60]" />
                </div>
                <span className="font-mono text-xs text-muted">Python</span>
              </div>
              <pre className="max-w-full overflow-x-auto px-4 py-4 font-mono text-sm leading-6 text-[#f0ede6]/90">
                <code>
                  <span className="text-muted">
                    {'# Ganti base_url saja, kode lainnya tidak berubah'}
                  </span>
                  {'\n'}
                  <span className="text-oxide">from</span> openai{' '}
                  <span className="text-oxide">import</span> OpenAI
                  {'\n'}
                  {'client = OpenAI(\n'}
                  {'    base_url='}
                  <span className="text-[#4a9e8e]">"https://rexu.ai.id/v1"</span>
                  {',\n'}
                  {'    api_key='}
                  <span className="text-[#4a9e8e]">"sk-rxu-..."</span>
                  {'\n)'}
                </code>
              </pre>
            </div>
          </div>
        </section>

        <section className="border-t border-line">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
            <h2 className="max-w-2xl text-2xl font-bold tracking-[-0.04em] sm:text-3xl">
              Satu saldo RC, tiga cara pakai.
            </h2>

            <div className="mt-10 grid gap-x-10 lg:grid-cols-3">
              {workflow.map((item, index) => {
                const Icon = item.icon;
                return (
                  <article key={item.title} className="border-t border-line py-6">
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-mono text-xs text-muted">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <Icon className="size-5 text-oxide" />
                    </div>
                    <h3 className="mt-5 text-lg font-semibold">{item.title}</h3>
                    <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">{item.body}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="border-t border-line">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
            <h2 className="max-w-2xl text-2xl font-bold tracking-[-0.04em] sm:text-3xl">
              30+ model dari satu endpoint.
            </h2>

            <div className="mt-8 grid grid-cols-2 gap-x-4 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4 xl:grid-cols-5">
              {models.map((model) => (
                <span
                  key={model}
                  className="min-w-0 border-t border-line py-2.5 font-mono text-sm break-words text-ink"
                >
                  {model}
                </span>
              ))}
            </div>
            <p className="mt-5 font-mono text-xs text-muted">dan 20+ model lainnya</p>
          </div>
        </section>

        <section id="harga" className="scroll-mt-20 border-t border-line">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
            <h2 className="text-2xl font-bold tracking-[-0.04em] sm:text-3xl">Pilih paket RC.</h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
              Tidak ada biaya tersembunyi. Bayar sesuai pemakaian.
            </p>

            <div className="mt-10 grid grid-cols-2 gap-3 lg:grid-cols-3">
              {plans.map((plan) => (
                <article
                  key={plan.name}
                  className={`relative flex flex-col border p-5 ${
                    plan.featured ? 'border-oxide' : 'border-line'
                  }`}
                >
                  {plan.featured ? (
                    <span className="absolute top-0 right-0 bg-oxide px-1.5 py-0.5 font-mono text-[10px] text-chalk">
                      Paling populer
                    </span>
                  ) : null}
                  <h3 className="text-sm font-medium">{plan.name}</h3>
                  <p className="mt-3 font-mono text-2xl font-bold">
                    {formatNumber(plan.rcAmount)} RC
                  </p>
                  <p className="mt-1 text-sm text-muted">Rp {formatNumber(plan.priceIdr)}</p>
                  <p className="mt-1 font-mono text-xs text-muted">{formatRate(plan)} RC/Rp</p>
                  <Link
                    to="/login"
                    className={`mt-5 inline-flex min-h-11 items-center justify-center border px-4 text-sm font-semibold transition-colors duration-150 ${
                      plan.featured
                        ? 'border-oxide bg-oxide text-chalk hover:border-petrol hover:bg-petrol'
                        : 'border-line text-ink hover:border-ink'
                    }`}
                  >
                    Mulai sekarang
                  </Link>
                </article>
              ))}
            </div>

            <p className="mt-6 text-center font-mono text-xs text-muted">
              Pembayaran via QRIS · RC tidak kedaluwarsa selama akun aktif
            </p>
          </div>
        </section>

        <section id="faq" className="scroll-mt-20 border-t border-line">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
            <div className="mx-auto max-w-2xl">
              <h2 className="text-2xl font-bold tracking-[-0.04em] sm:text-3xl">
                Pertanyaan umum.
              </h2>

              <div className="mt-8 border-b border-line">
                {faqs.map((faq, index) => {
                  const open = openFaq === index;
                  return (
                    <div key={faq.question} className="border-t border-line">
                      <h3>
                        <button
                          type="button"
                          id={`faq-button-${index}`}
                          aria-expanded={open}
                          aria-controls={`faq-panel-${index}`}
                          onClick={() => setOpenFaq(open ? null : index)}
                          className="flex min-h-11 w-full items-center justify-between gap-4 py-4 text-left text-base font-medium"
                        >
                          <span>{faq.question}</span>
                          <ChevronDown
                            className={`size-4 shrink-0 text-muted transition-transform duration-200 ${
                              open ? 'rotate-180' : ''
                            }`}
                          />
                        </button>
                      </h3>
                      <section
                        id={`faq-panel-${index}`}
                        aria-labelledby={`faq-button-${index}`}
                        aria-hidden={!open}
                        className={`grid transition-[grid-template-rows] duration-200 ${
                          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                        }`}
                      >
                        <div className="overflow-hidden">
                          <p
                            className={`pb-5 pr-8 text-sm leading-relaxed text-muted transition-opacity duration-200 ${
                              open ? 'opacity-100' : 'opacity-0'
                            }`}
                          >
                            {faq.answer}
                          </p>
                        </div>
                      </section>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-paper">
        <div className="mx-auto w-full max-w-6xl px-6 py-10 md:px-8">
          <div className="flex flex-col gap-8 text-center md:grid md:grid-cols-3 md:gap-10 md:text-left">
            <div>
              <Link
                to="/"
                onClick={() => window.scrollTo(0, 0)}
                className="inline-flex min-h-11 items-center"
                aria-label="Rexu, kembali ke atas"
              >
                <Wordmark />
              </Link>
              <p className="mt-2 text-xs text-muted">Akses 30+ model AI dari satu tempat.</p>
              <p className="mt-4 hidden text-xs text-muted md:block">
                © 2026 Rexu. Semua hak dilindungi.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-8 md:contents">
              <div>
                <p className="mb-3 font-mono text-xs uppercase tracking-wider text-muted">Produk</p>
                <ul className="space-y-2">
                  <li>
                    <Link
                      to="/"
                      onClick={() => window.scrollTo(0, 0)}
                      className="text-sm text-muted transition-colors duration-150 hover:text-ink"
                    >
                      Beranda
                    </Link>
                  </li>
                  {footerSections.map((section) => (
                    <li key={section.label}>
                      <a
                        href={section.href}
                        onClick={(event) => handleSectionClick(event, section.href)}
                        className="text-sm text-muted transition-colors duration-150 hover:text-ink"
                      >
                        {section.label}
                      </a>
                    </li>
                  ))}
                  <li>
                    <Link
                      to="/login"
                      className="text-sm text-muted transition-colors duration-150 hover:text-ink"
                    >
                      Masuk
                    </Link>
                  </li>
                </ul>
              </div>

              <div>
                <p className="mb-3 font-mono text-xs uppercase tracking-wider text-muted">Tautan</p>
                <ul className="space-y-2">
                  <li>
                    <Link
                      to="/docs"
                      className="text-sm text-muted transition-colors duration-150 hover:text-ink"
                    >
                      Dokumentasi
                    </Link>
                  </li>
                  {upcomingLinks.map((label) => (
                    <li key={label}>
                      <span
                        aria-disabled="true"
                        title="Segera tersedia"
                        className="inline-flex cursor-not-allowed items-center gap-2 text-sm text-muted/50"
                      >
                        {label}
                        <span className="rounded-none border border-muted/20 px-1 font-mono text-[10px] text-muted/40">
                          Segera
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <p className="mt-8 border-t border-line pt-6 text-center text-xs text-muted md:hidden">
            © 2026 Rexu
          </p>
        </div>
      </footer>
    </div>
  );
}
