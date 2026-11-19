import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { PublicNav } from '../components/PublicNav';
import { Button } from '../components/ui/Button';
import { useAuth } from '../features/auth/AuthProvider';
import { api } from '../lib/api';

const facts = [
  { value: '30+ model', label: 'Katalog model' },
  { value: 'OpenAI-compatible', label: 'API format' },
  { value: 'Per-request', label: 'Billing RC' },
];

const inputClass =
  'mt-1.5 block min-h-11 w-full border border-line bg-paper px-3 text-sm text-ink outline-none placeholder:text-muted focus:border-ink dark:bg-chalk/5';

type Tab = 'login' | 'register';
type RegisterStep = 'form' | 'otp';

export function LoginPage() {
  const { user, loading, login, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [tab, setTab] = useState<Tab>('login');

  // Login
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);

  // Register
  const [step, setStep] = useState<RegisterStep>('form');
  const [username, setUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [regError, setRegError] = useState<string | null>(null);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [resendLeft, setResendLeft] = useState(0);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  const otpRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (tab === 'register' && step === 'otp') otpRef.current?.focus();
  }, [tab, step]);

  useEffect(() => {
    if (step !== 'otp' || resendLeft <= 0) return;
    const timer = window.setTimeout(() => setResendLeft((value) => value - 1), 1_000);
    return () => window.clearTimeout(timer);
  }, [step, resendLeft]);

  if (!loading && user) return <Navigate to="/" replace />;

  function changeTab(next: Tab) {
    setTab(next);
    setLoginError(null);
    setRegError(null);
    if (next === 'login') {
      setStep('form');
      setOtp('');
      setResendLeft(0);
      setResendMessage(null);
    }
  }

  async function onLogin(event: FormEvent) {
    event.preventDefault();
    setLoginError(null);
    setLoginBusy(true);
    try {
      await login(email, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (caught) {
      setLoginError(caught instanceof Error ? caught.message : 'Login gagal');
    } finally {
      setLoginBusy(false);
    }
  }

  async function sendOtp(event: FormEvent) {
    event.preventDefault();
    if (sendingOtp) return;

    setRegError(null);
    setResendMessage(null);

    if (username.trim().length < 2) {
      setRegError('Username minimal 2 karakter.');
      return;
    }
    if (regPassword.length < 8) {
      setRegError('Password minimal 8 karakter.');
      return;
    }

    setSendingOtp(true);

    try {
      await api('/api/auth/send-otp', {
        method: 'POST',
        body: JSON.stringify({ email: regEmail }),
      });
      setOtp('');
      setStep('otp');
      setResendLeft(60);
    } catch (caught) {
      setRegError(caught instanceof Error ? caught.message : 'Gagal mengirim kode verifikasi');
    } finally {
      setSendingOtp(false);
    }
  }

  async function resendOtp() {
    if (resendLeft > 0 || resending) return;

    setRegError(null);
    setResendMessage(null);
    setResending(true);

    try {
      await api('/api/auth/send-otp', {
        method: 'POST',
        body: JSON.stringify({ email: regEmail }),
      });
      setResendLeft(60);
      setResendMessage('Kode baru sudah dikirim.');
    } catch (caught) {
      setRegError(caught instanceof Error ? caught.message : 'Gagal mengirim ulang kode');
    } finally {
      setResending(false);
    }
  }

  function backToForm() {
    setStep('form');
    setOtp('');
    setRegError(null);
    setResendLeft(0);
    setResendMessage(null);
  }

  async function onRegister(event: FormEvent) {
    event.preventDefault();
    if (registering) return;

    setRegError(null);

    if (otp.length !== 6) {
      setRegError('Masukkan 6 digit kode verifikasi.');
      return;
    }

    setRegistering(true);

    try {
      await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: username.trim(),
          email: regEmail,
          password: regPassword,
          otp,
        }),
      });
      await refresh();
      navigate('/app', { replace: true });
    } catch (caught) {
      setRegError(caught instanceof Error ? caught.message : 'Pendaftaran gagal');
    } finally {
      setRegistering(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <PublicNav />
      <main className="grid flex-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className="border-b border-line px-6 py-8 sm:py-10 lg:border-r lg:border-b-0 lg:px-12 lg:py-12">
          <div className="reveal max-w-xl">
            <h1 className="max-w-lg text-5xl leading-[0.95] font-extrabold tracking-[-0.055em] text-ink sm:text-6xl">
              Satu API key.
              <br />
              Banyak model AI.
            </h1>
            <p className="mt-6 max-w-md text-lg text-muted">
              Kirim satu request, lihat model yang menjawab, dan pantau pemakaian RC.
            </p>
            <div className="mt-8 grid max-w-md grid-cols-3 gap-4 border-t border-line">
              {facts.map((fact) => (
                <div key={fact.label} className="pt-4">
                  <p className="font-mono text-xs text-muted">{fact.label}</p>
                  <p className="mt-1 text-sm font-medium leading-tight">{fact.value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">
            <div className="mb-6 flex border-b border-line">
              <button
                type="button"
                onClick={() => changeTab('login')}
                className={`flex-1 border-b-2 py-2 text-sm transition-colors duration-150 ${
                  tab === 'login'
                    ? 'border-oxide font-medium text-ink'
                    : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                Masuk
              </button>
              <button
                type="button"
                onClick={() => changeTab('register')}
                className={`flex-1 border-b-2 py-2 text-sm transition-colors duration-150 ${
                  tab === 'register'
                    ? 'border-oxide font-medium text-ink'
                    : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                Daftar
              </button>
            </div>

            {tab === 'login' ? (
              <form onSubmit={onLogin}>
                <h2 className="text-2xl font-bold tracking-[-0.03em]">Masuk ke workspace</h2>
                <p className="mt-2 text-sm text-muted">Masuk ke akun Rexu kamu.</p>

                <div className="mt-8 space-y-4">
                  <label className="block">
                    <span className="text-sm font-medium">Email</span>
                    <input
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className={inputClass}
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
                      className={inputClass}
                      placeholder="••••••••••••"
                    />
                  </label>
                </div>

                {loginError ? (
                  <p role="alert" className="mt-4 border-l-2 border-oxide pl-3 text-sm text-oxide">
                    {loginError}
                  </p>
                ) : null}

                <Button type="submit" disabled={loginBusy} className="mt-6 w-full">
                  {loginBusy ? 'Memeriksa' : 'Masuk'}
                </Button>
              </form>
            ) : step === 'form' ? (
              <form onSubmit={(event) => void sendOtp(event)}>
                <h2 className="text-2xl font-bold tracking-[-0.03em]">Buat akun baru</h2>
                <p className="mt-2 text-sm text-muted">
                  Isi data berikut, lalu verifikasi email kamu.
                </p>

                <div className="mt-8 space-y-4">
                  <label className="block">
                    <span className="text-sm font-medium">Username</span>
                    <input
                      type="text"
                      autoComplete="username"
                      required
                      minLength={2}
                      maxLength={80}
                      value={username}
                      onChange={(event) => {
                        setUsername(event.target.value);
                        setRegError(null);
                      }}
                      className={inputClass}
                      placeholder="budi"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium">Email</span>
                    <input
                      type="email"
                      autoComplete="email"
                      required
                      value={regEmail}
                      onChange={(event) => {
                        setRegEmail(event.target.value);
                        setRegError(null);
                      }}
                      className={inputClass}
                      placeholder="nama@domain.id"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium">Password</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      required
                      value={regPassword}
                      onChange={(event) => {
                        setRegPassword(event.target.value);
                        setRegError(null);
                      }}
                      className={inputClass}
                      placeholder="Minimal 8 karakter"
                    />
                  </label>
                </div>

                {regError ? (
                  <p role="alert" className="mt-4 border-l-2 border-oxide pl-3 text-sm text-oxide">
                    {regError}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={sendingOtp}
                  className="mt-6 w-full bg-oxide py-3 text-sm font-medium text-chalk transition-opacity duration-150 hover:opacity-90 disabled:opacity-60"
                >
                  {sendingOtp ? 'Mengirim...' : 'Daftar'}
                </button>
              </form>
            ) : (
              <form onSubmit={onRegister}>
                <h2 className="text-2xl font-bold tracking-[-0.03em]">Verifikasi email</h2>

                <div className="mt-4">
                  <button
                    type="button"
                    onClick={backToForm}
                    className="text-xs text-muted transition-colors duration-150 hover:text-ink"
                  >
                    ← Ubah data
                  </button>
                  <p className="mt-1 font-mono text-xs text-muted">Kode dikirim ke {regEmail}</p>
                </div>

                <div className="mt-5 space-y-4">
                  <label className="block">
                    <span className="text-sm font-medium">Kode verifikasi</span>
                    <input
                      ref={otpRef}
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      required
                      value={otp}
                      onChange={(event) => {
                        setOtp(event.target.value.replace(/\D/g, '').slice(0, 6));
                        setRegError(null);
                      }}
                      className={`${inputClass} text-center font-mono text-xl tracking-[0.3em]`}
                      placeholder="123456"
                    />
                  </label>
                </div>

                {regError ? (
                  <p role="alert" className="mt-4 border-l-2 border-oxide pl-3 text-sm text-oxide">
                    {regError}
                  </p>
                ) : null}

                <div className="mt-4 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => void resendOtp()}
                    disabled={resendLeft > 0 || resending}
                    className="font-mono text-xs text-muted transition-colors duration-150 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {resendLeft > 0 ? `Kirim ulang (${resendLeft}d)` : 'Kirim ulang kode'}
                  </button>
                  {resendMessage ? (
                    <span className="font-mono text-xs text-petrol">{resendMessage}</span>
                  ) : null}
                </div>

                <button
                  type="submit"
                  disabled={registering}
                  className="mt-4 w-full bg-oxide py-3 text-sm font-medium text-chalk transition-opacity duration-150 hover:opacity-90 disabled:opacity-60"
                >
                  {registering ? 'Membuat akun...' : 'Buat akun'}
                </button>
              </form>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
