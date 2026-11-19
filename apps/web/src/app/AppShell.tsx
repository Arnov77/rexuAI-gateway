import { type ReactNode, useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Wordmark } from '../components/Wordmark';
import { useAuth } from '../features/auth/AuthProvider';
import { api } from '../lib/api';

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
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function HouseIcon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </IconBase>
  );
}

function TerminalIcon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" x2="20" y1="19" y2="19" />
    </IconBase>
  );
}

function CpuIcon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <rect width="16" height="16" x="4" y="4" rx="2" />
      <rect width="6" height="6" x="9" y="9" rx="1" />
      <path d="M15 2v2" />
      <path d="M15 20v2" />
      <path d="M2 15h2" />
      <path d="M2 9h2" />
      <path d="M20 15h2" />
      <path d="M20 9h2" />
      <path d="M9 2v2" />
      <path d="M9 20v2" />
    </IconBase>
  );
}

function BarChartIcon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <line x1="12" x2="12" y1="20" y2="10" />
      <line x1="18" x2="18" y1="20" y2="4" />
      <line x1="6" x2="6" y1="20" y2="16" />
    </IconBase>
  );
}

function KeyIcon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
      <path d="m21 2-9.6 9.6" />
      <circle cx="7.5" cy="15.5" r="5.5" />
    </IconBase>
  );
}

function CreditCardIcon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <line x1="2" x2="22" y1="10" y2="10" />
    </IconBase>
  );
}

function MenuIcon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <line x1="4" x2="20" y1="6" y2="6" />
      <line x1="4" x2="20" y1="12" y2="12" />
      <line x1="4" x2="20" y1="18" y2="18" />
    </IconBase>
  );
}

function LayoutDashboardIcon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <rect width="7" height="9" x="3" y="3" rx="1" />
      <rect width="7" height="5" x="14" y="3" rx="1" />
      <rect width="7" height="9" x="14" y="12" rx="1" />
      <rect width="7" height="5" x="3" y="16" rx="1" />
    </IconBase>
  );
}

function UsersIcon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </IconBase>
  );
}

function RefreshCwIcon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </IconBase>
  );
}

function PackageIcon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" />
      <path d="M12 22V12" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="m7.5 4.27 9 5.15" />
    </IconBase>
  );
}

function LogOutIcon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </IconBase>
  );
}

type NavItem = {
  to: string;
  label: string;
  icon: (props: IconProps) => ReactNode;
  end?: boolean;
  badge?: number;
};

const menuItems: NavItem[] = [
  { to: '/app', label: 'Beranda', icon: HouseIcon, end: true },
  { to: '/app/playground', label: 'Playground', icon: TerminalIcon },
  { to: '/app/models', label: 'Model', icon: CpuIcon },
  { to: '/app/usage', label: 'Usage Log', icon: BarChartIcon },
];

const developerItems: NavItem[] = [{ to: '/app/keys', label: 'API Key', icon: KeyIcon }];

const adminItems: NavItem[] = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboardIcon, end: true },
  { to: '/admin/models', label: 'Model', icon: CpuIcon },
  { to: '/admin/packages', label: 'Paket', icon: PackageIcon },
  { to: '/admin/users', label: 'Pengguna', icon: UsersIcon },
  { to: '/admin/reconcile', label: 'Rekonsiliasi', icon: RefreshCwIcon },
];

const billingItems: NavItem[] = [{ to: '/app/topup', label: 'Top Up', icon: CreditCardIcon }];

function formatRc(value: string | null | undefined): string {
  if (value == null) return '0';
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat('id-ID').format(number) : String(value);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'R';
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function NavGroup({
  label,
  items,
  onNavigate,
}: {
  label: string;
  items: NavItem[];
  onNavigate: () => void;
}) {
  return (
    <div>
      <p className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted/60">
        {label}
      </p>
      <div className="flex flex-col">
        {items.map(({ to, label: itemLabel, icon: Icon, end, badge }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-none border-l-2 px-3 py-2 text-sm transition-colors duration-150 ${
                isActive
                  ? 'border-oxide bg-transparent font-medium text-ink'
                  : 'border-transparent text-muted hover:bg-ink/5 hover:text-ink'
              }`
            }
          >
            <Icon className="size-4" />
            <span className="min-w-0 flex-1 truncate">{itemLabel}</span>
            {badge != null && badge > 0 ? (
              <span className="min-w-5 rounded-full bg-oxide px-1.5 py-0.5 text-center font-mono text-[10px] leading-none text-chalk">
                {badge > 99 ? '99+' : badge}
              </span>
            ) : null}
          </NavLink>
        ))}
      </div>
    </div>
  );
}

export function AppShell() {
  const { user, wallet, loading, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pendingReconcile, setPendingReconcile] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const isAdmin = user?.role === 'admin';

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      navigate('/', { replace: true });
    }
  }

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;

    async function loadPending() {
      try {
        const data = await api<{ total?: number }>(
          '/api/admin/usage?status=reconciliation&limit=1',
        );
        if (!cancelled) setPendingReconcile(data.total ?? 0);
      } catch {
        // The badge is non-critical; leave the last known count.
      }
    }

    void loadPending();
    window.addEventListener('rexu:reconcile-updated', loadPending);
    return () => {
      cancelled = true;
      window.removeEventListener('rexu:reconcile-updated', loadPending);
    };
  }, [isAdmin]);

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-paper">
        <div className="reveal flex items-center gap-3 text-sm text-muted">
          <span className="size-2 bg-oxide" />
          Memuat sesi
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Navigate
        to={loggingOut ? '/' : '/login'}
        replace
        state={loggingOut ? undefined : { from: location.pathname }}
      />
    );
  }

  const balance = `${formatRc(wallet?.remainingRc)} RC`;

  return (
    <div className="min-h-dvh bg-paper md:grid md:grid-cols-[240px_1fr]">
      <header className="sticky top-0 z-30 grid h-14 grid-cols-[1fr_auto_1fr] items-center border-b border-line bg-paper px-4 md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Buka menu"
          aria-expanded={open}
          className="-ml-2 grid size-9 place-items-center text-ink hover:bg-ink/5"
        >
          <MenuIcon className="size-5" />
        </button>
        <Wordmark />
        <span className="min-w-0 justify-self-end truncate text-right font-mono text-sm tnum">
          {balance}
        </span>
      </header>

      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Tutup menu"
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 ease-out md:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col overflow-y-auto border-r border-line bg-paper transition-transform duration-200 ease-out md:sticky md:top-0 md:bottom-auto md:z-0 md:h-dvh md:w-auto md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-5 pb-6 pt-6 md:px-6">
          <Wordmark />
          <p className="mt-1 font-mono text-xs text-muted">AI gateway</p>
        </div>

        <nav className="flex flex-col gap-4 px-3 pb-6">
          <NavGroup label="MENU" items={menuItems} onNavigate={() => setOpen(false)} />
          <NavGroup label="DEVELOPER" items={developerItems} onNavigate={() => setOpen(false)} />
          {isAdmin ? (
            <NavGroup
              label="ADMIN"
              items={adminItems.map((item) =>
                item.to === '/admin/reconcile' ? { ...item, badge: pendingReconcile } : item,
              )}
              onNavigate={() => setOpen(false)}
            />
          ) : null}
          <NavGroup label="BILLING" items={billingItems} onNavigate={() => setOpen(false)} />
        </nav>

        <div className="mt-auto border-t border-line">
          <div className="px-4 py-4">
            <p className="font-mono text-[10px] text-muted">Saldo</p>
            <p className="mt-1 font-mono text-lg font-medium tnum">{balance}</p>
          </div>

          <div className="border-t border-line px-4 py-4">
            <div className="flex items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-oxide text-xs font-semibold text-chalk">
                {initials(user.name)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="truncate font-mono text-xs text-muted">{user.email}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink"
            >
              <LogOutIcon className="size-3.5" />
              Keluar
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col">
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
