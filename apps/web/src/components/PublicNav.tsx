import { type MouseEvent, type ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wordmark } from './Wordmark';

const THEME_KEY = 'rexu-theme';
const NAVBAR_HEIGHT = 64;

type Theme = 'light' | 'dark';

export type PublicNavLink = {
  href: string;
  label: string;
};

type PublicNavProps = {
  links?: PublicNavLink[];
  showLogin?: boolean;
};

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

function Sun({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </IconBase>
  );
}

function Moon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </IconBase>
  );
}

function Menu({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </IconBase>
  );
}

function X({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </IconBase>
  );
}

function getInitialTheme(): Theme {
  const stored = window.localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function scrollToSection(sectionId: string) {
  const element = document.getElementById(sectionId);
  if (!element) return;

  const y = element.getBoundingClientRect().top + window.scrollY - NAVBAR_HEIGHT;
  window.scrollTo({
    top: y,
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
}

export function PublicNav({ links = [], showLogin = false }: PublicNavProps) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [menuOpen, setMenuOpen] = useState(false);
  const hasLinks = links.length > 0;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.classList.toggle('light', theme === 'light');
  }, [theme]);

  function toggleTheme() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    window.localStorage.setItem(THEME_KEY, next);
  }

  function handleAnchorClick(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (!href.startsWith('#')) return;
    event.preventDefault();
    scrollToSection(href.slice(1));
    setMenuOpen(false);
  }

  const themeLabel = theme === 'dark' ? 'Terang' : 'Gelap';
  const themeAria = theme === 'dark' ? 'Aktifkan mode terang' : 'Aktifkan mode gelap';
  const ThemeIcon = theme === 'dark' ? Sun : Moon;
  const themeVisibility = hasLinks ? 'hidden min-w-11 lg:inline-flex' : 'inline-flex min-w-11';

  return (
    <>
      {hasLinks ? (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden={!menuOpen}
          aria-label="Tutup menu"
          onClick={() => setMenuOpen(false)}
          className={`fixed inset-0 z-40 cursor-default bg-black/20 transition-opacity duration-200 ease-out lg:hidden ${
            menuOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          }`}
        />
      ) : null}

      <header className="sticky top-0 z-50 border-b border-line bg-paper">
        <div className="relative">
          <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <Link
              to="/"
              onClick={() => {
                setMenuOpen(false);
                window.scrollTo(0, 0);
              }}
              className="-ml-1 inline-flex min-h-11 items-center"
              aria-label="Rexu, kembali ke atas"
            >
              <Wordmark />
            </Link>

            {hasLinks ? (
              <nav className="hidden items-center gap-8 lg:flex" aria-label="Navigasi utama">
                {links.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    onClick={(event) => handleAnchorClick(event, link.href)}
                    className="inline-flex min-h-11 items-center text-sm text-muted transition-colors duration-150 hover:text-ink"
                  >
                    {link.label}
                  </a>
                ))}
              </nav>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={themeAria}
                className={`${themeVisibility} min-h-11 items-center justify-center gap-2 border border-line px-3 text-sm text-muted transition-colors duration-150 hover:border-ink hover:text-ink`}
              >
                <ThemeIcon className="size-4" />
                <span className="hidden sm:inline">{themeLabel}</span>
              </button>

              {showLogin ? (
                <Link
                  to="/login"
                  onClick={() => setMenuOpen(false)}
                  className="hidden min-h-11 items-center border border-line px-4 text-sm font-semibold transition-colors duration-150 hover:border-ink lg:inline-flex"
                >
                  Masuk
                </Link>
              ) : null}

              {hasLinks ? (
                <button
                  type="button"
                  onClick={() => setMenuOpen((open) => !open)}
                  aria-label={menuOpen ? 'Tutup menu' : 'Buka menu'}
                  aria-expanded={menuOpen}
                  aria-controls="public-mobile-menu"
                  className="inline-flex size-11 items-center justify-center border border-line lg:hidden"
                >
                  <span
                    className={`inline-flex transition-transform duration-200 ease-out ${
                      menuOpen ? 'rotate-90' : 'rotate-0'
                    }`}
                  >
                    {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
                  </span>
                </button>
              ) : null}
            </div>
          </div>

          {hasLinks ? (
            <div
              id="public-mobile-menu"
              aria-hidden={!menuOpen}
              inert={!menuOpen}
              className={`absolute top-full right-0 left-0 z-50 border-t border-b border-line bg-paper transition-[opacity,transform,translate] duration-200 ease-out lg:hidden ${
                menuOpen
                  ? 'pointer-events-auto translate-y-0 opacity-100'
                  : 'pointer-events-none -translate-y-2 opacity-0'
              }`}
            >
              <nav
                className="mx-auto flex w-full max-w-6xl flex-col px-4 py-2 sm:px-6"
                aria-label="Navigasi seluler"
              >
                {links.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    onClick={(event) => handleAnchorClick(event, link.href)}
                    className="flex min-h-11 items-center border-b border-line text-sm"
                  >
                    {link.label}
                  </a>
                ))}
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="flex min-h-11 items-center gap-2 border-b border-line text-sm text-muted"
                >
                  <ThemeIcon className="size-4" />
                  <span>{theme === 'dark' ? 'Mode terang' : 'Mode gelap'}</span>
                </button>
                {showLogin ? (
                  <Link
                    to="/login"
                    onClick={() => setMenuOpen(false)}
                    className="mt-2 mb-2 flex min-h-11 items-center justify-center border border-oxide bg-oxide px-4 text-sm font-semibold text-chalk"
                  >
                    Masuk
                  </Link>
                ) : null}
              </nav>
            </div>
          ) : null}
        </div>
      </header>
    </>
  );
}
