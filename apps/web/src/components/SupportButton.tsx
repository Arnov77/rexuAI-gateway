import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react';

// Kontak support yang tampil di floating button.
const WA_NUMBER = '6285854751847';
const TG_USERNAME = 'Opak7';
const SUPPORT_EMAIL = 'support@rexu.ai.id';

const POSITION_KEY = 'rexu-support-bottom';
const DEFAULT_BOTTOM = 24;
const MIN_BOTTOM = 16;
const DRAG_THRESHOLD = 5;

type IconProps = {
  className?: string;
};

type DragState = {
  pointerId: number;
  startY: number;
  startBottom: number;
  currentBottom: number;
  moved: boolean;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getMaxBottom(root: HTMLElement | null): number {
  const height = root?.offsetHeight ?? 48;
  // Sisakan ruang untuk notch/safe-area di atas.
  return Math.max(MIN_BOTTOM, window.innerHeight - height - 44);
}

function HelpIcon({ className = 'size-6' }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <rect width="4" height="6" x="2" y="13" rx="1" />
      <rect width="4" height="6" x="18" y="13" rx="1" />
      <path d="M20 19a4 4 0 0 1-4 3h-2" />
    </svg>
  );
}

function WhatsAppIcon({ className = 'size-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#25D366"
        d="M12.04 2a9.9 9.9 0 0 0-8.5 15L2 22l5.13-1.5A9.9 9.9 0 1 0 12.04 2zm0 18.1a8.2 8.2 0 0 1-4.18-1.14l-.3-.18-3.1.9.83-3.02-.2-.31a8.2 8.2 0 1 1 6.95 3.75z"
      />
      <path
        fill="#25D366"
        d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.26-.47-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.18-.3-.02-.46.13-.6.13-.14.3-.35.44-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.05-.52-.1-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.07c.15.2 2.1 3.2 5.08 4.49.7.3 1.26.49 1.69.62.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.18-1.42-.08-.12-.28-.2-.57-.34z"
      />
    </svg>
  );
}

function TelegramIcon({ className = 'size-4' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#229ED9"
        d="M21.94 4.6a1.2 1.2 0 0 0-1.23-.18L2.9 11.5c-.77.3-.74 1.4.05 1.66l4.3 1.42 1.64 5.28c.16.5.78.66 1.17.3l2.38-2.17 4.27 3.15c.44.32 1.06.1 1.2-.42l4.06-15.5c.1-.38-.06-.77-.33-.98zM9.1 13.2l8.9-5.9-7.3 6.7-.3 3.5-1.3-4.3z"
      />
    </svg>
  );
}

function MailIcon({ className = 'size-4' }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect width="18" height="14" x="3" y="5" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

const contacts = [
  {
    label: 'Email',
    href: `mailto:${SUPPORT_EMAIL}`,
    icon: MailIcon,
    iconClassName: 'size-4 text-muted',
    external: false,
  },
  {
    label: 'Telegram',
    href: `https://t.me/${TG_USERNAME}`,
    icon: TelegramIcon,
    iconClassName: 'size-4',
    external: true,
  },
  {
    label: 'WhatsApp',
    href: `https://wa.me/${WA_NUMBER}`,
    icon: WhatsAppIcon,
    iconClassName: 'size-4',
    external: true,
  },
];

export function SupportButton() {
  const [open, setOpen] = useState(false);
  const [bottom, setBottom] = useState(DEFAULT_BOTTOM);
  const [dragging, setDragging] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(POSITION_KEY));
    const initial = Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_BOTTOM;
    setBottom(clamp(initial, MIN_BOTTOM, getMaxBottom(rootRef.current)));

    const handleResize = () =>
      setBottom((value) => clamp(value, MIN_BOTTOM, getMaxBottom(rootRef.current)));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: globalThis.PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startBottom: bottom,
      currentBottom: bottom,
      moved: false,
    };
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const delta = drag.startY - event.clientY;
    if (!drag.moved && Math.abs(delta) < DRAG_THRESHOLD) return;

    if (!drag.moved) {
      drag.moved = true;
      setDragging(true);
      setOpen(false);
    }

    const next = clamp(drag.startBottom + delta, MIN_BOTTOM, getMaxBottom(rootRef.current));
    drag.currentBottom = next;
    setBottom(next);
  }

  function handlePointerUp(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    dragRef.current = null;
    setDragging(false);

    if (!drag.moved) return;

    window.localStorage.setItem(POSITION_KEY, String(drag.currentBottom));
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }

  function handlePointerCancel() {
    dragRef.current = null;
    setDragging(false);
  }

  function handleClick() {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setOpen((current) => !current);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const step = event.key === 'ArrowUp' ? 24 : -24;
    const next = clamp(bottom + step, MIN_BOTTOM, getMaxBottom(rootRef.current));
    setBottom(next);
    window.localStorage.setItem(POSITION_KEY, String(next));
  }

  return (
    <div
      ref={rootRef}
      className="fixed right-6 z-50 flex flex-col items-end gap-3"
      style={{ bottom: `calc(${bottom}px + env(safe-area-inset-bottom, 0px))` }}
    >
      <div
        id="support-menu"
        aria-hidden={!open}
        className={`flex origin-bottom-right flex-col items-end gap-2 transition-all duration-200 ease-out ${
          open ? 'scale-100 opacity-100' : 'pointer-events-none scale-0 opacity-0'
        }`}
      >
        {contacts.map(({ label, href, icon: Icon, iconClassName, external }) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel={external ? 'noreferrer' : undefined}
            tabIndex={open ? 0 : -1}
            onClick={() => setOpen(false)}
            className="flex w-36 items-center gap-2 rounded-none border border-line bg-paper px-3 py-2 text-sm text-ink shadow-md transition-colors duration-150 hover:border-ink dark:bg-[#1a1a18]"
          >
            <Icon className={iconClassName} />
            <span>{label}</span>
          </a>
        ))}
      </div>

      <div className="group relative">
        <span
          className={`pointer-events-none absolute top-1/2 right-full mr-3 hidden -translate-y-1/2 bg-ink px-2 py-1 text-xs whitespace-nowrap text-chalk opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 ${
            dragging ? 'md:hidden' : 'md:block'
          }`}
        >
          Butuh bantuan?
        </span>
        <button
          ref={buttonRef}
          type="button"
          aria-label="Menu bantuan"
          aria-expanded={open}
          aria-controls="support-menu"
          aria-haspopup="true"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          className={`grid size-12 touch-none place-items-center rounded-full bg-oxide text-chalk shadow-lg transition-colors duration-150 select-none hover:bg-petrol focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-oxide ${
            dragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
        >
          <HelpIcon className="size-6" />
        </button>
      </div>
    </div>
  );
}
