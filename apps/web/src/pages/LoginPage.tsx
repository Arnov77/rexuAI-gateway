import { type FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { PublicNav } from '../components/PublicNav';
import { Button } from '../components/ui/Button';
import { useAuth } from '../features/auth/AuthProvider';

const loginFacts = [
  { value: '30+ model', label: 'Katalog model' },
  { value: 'OpenAI-compatible', label: 'API format' },
  { value: 'Per-request', label: 'Billing RC' },
];

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Login gagal');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <PublicNav />
      <main className="grid flex-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className="border-b border-line px-6 py-8 sm:py-10 lg:border-r lg:border-b-0 lg:px-12 lg:py-12">
          <div className="reveal max-w-xl">
            <h1 className="max-w-lg text-5xl leading-[0.95] font-extrabold tracking-[-0.055em] text-ink sm:text-6xl">
              Satu key. Banyak model.
            </h1>
            <p className="mt-6 max-w-md text-lg text-muted">
              Kirim satu request, lihat model yang menjawab, dan pantau pemakaian RC.
            </p>
            <div className="mt-8 grid max-w-md grid-cols-3 gap-4 border-t border-line">
              {loginFacts.map((fact) => (
                <div key={fact.label} className="pt-4">
                  <p className="font-mono text-xs text-muted">{fact.label}</p>
                  <p className="mt-1 text-sm font-medium leading-tight">{fact.value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center px-6 py-12">
          <form onSubmit={onSubmit} className="w-full max-w-sm">
            <h2 className="text-2xl font-bold tracking-[-0.03em]">Masuk ke workspace</h2>
            <p className="mt-2 text-sm text-muted">Gunakan akun yang dibuat admin.</p>

            <div className="mt-8 space-y-4">
              <label className="block">
                <span className="text-sm font-medium">Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-1.5 block min-h-11 w-full border border-line bg-paper px-3 text-sm text-ink outline-none placeholder:text-muted focus:border-ink dark:bg-chalk/5"
                  placeholder="nama@domain.id"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium">Password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-1.5 block min-h-11 w-full border border-line bg-paper px-3 text-sm text-ink outline-none placeholder:text-muted focus:border-ink dark:bg-chalk/5"
                  placeholder="••••••••••••"
                />
              </label>
            </div>

            {error ? (
              <p role="alert" className="mt-4 border-l-2 border-oxide pl-3 text-sm text-oxide">
                {error}
              </p>
            ) : null}

            <Button type="submit" disabled={busy} className="mt-6 w-full">
              {busy ? 'Memeriksa' : 'Masuk'}
            </Button>

            <p className="mt-6 text-xs leading-relaxed text-muted">
              Pendaftaran publik ditutup. Hubungi admin untuk membuat akun.
            </p>
          </form>
        </section>
      </main>
    </div>
  );
}
