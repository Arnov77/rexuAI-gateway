import { useLayoutEffect } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthProvider';
import { AdminDashboardPage } from '../pages/admin/AdminDashboardPage';
import { AdminModelsPage } from '../pages/admin/AdminModelsPage';
import { AdminPackagesPage } from '../pages/admin/AdminPackagesPage';
import { AdminReconcilePage } from '../pages/admin/AdminReconcilePage';
import { AdminUsersPage } from '../pages/admin/AdminUsersPage';
import { DashboardPage } from '../pages/DashboardPage';
import { KeysPage } from '../pages/KeysPage';
import { LandingPage } from '../pages/LandingPage';
import { LoginPage } from '../pages/LoginPage';
import { ModelsPage } from '../pages/ModelsPage';
import { PlaygroundPage } from '../pages/PlaygroundPage';
import { TopupPage } from '../pages/TopupPage';
import { UsagePage } from '../pages/UsagePage';
import { AppShell } from './AppShell';

const THEME_KEY = 'rexu-theme';

function applyStoredTheme() {
  const stored = window.localStorage.getItem(THEME_KEY);
  document.documentElement.classList.toggle('dark', stored === 'dark');
  document.documentElement.classList.toggle('light', stored === 'light');
}

function RequireAdmin() {
  const { user, loading } = useAuth();

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

  if (user?.role !== 'admin') return <Navigate to="/app" replace />;
  return <Outlet />;
}

export function AppRouter() {
  useLayoutEffect(() => {
    applyStoredTheme();
  }, []);

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<Navigate to="/login" replace />} />
      <Route path="/app" element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="playground" element={<PlaygroundPage />} />
        <Route path="models" element={<ModelsPage />} />
        <Route path="keys" element={<KeysPage />} />
        <Route path="usage" element={<UsagePage />} />
        <Route path="topup" element={<TopupPage />} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Route>
      <Route element={<RequireAdmin />}>
        <Route path="/admin" element={<AppShell />}>
          <Route index element={<AdminDashboardPage />} />
          <Route path="models" element={<AdminModelsPage />} />
          <Route path="packages" element={<AdminPackagesPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="reconcile" element={<AdminReconcilePage />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
      </Route>
      <Route path="/models" element={<Navigate to="/app/models" replace />} />
      <Route path="/keys" element={<Navigate to="/app/keys" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
