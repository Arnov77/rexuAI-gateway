import { useEffect, useRef, useState } from 'react';

// Kontak support yang tampil di floating button.
const WA_NUMBER = '6285854751847';
const TG_USERNAME = 'Opak7';
const SUPPORT_EMAIL = 'support@rexu.ai.id';

type IconProps = {
  className?: string;
};

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
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
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

  return (
    <div
      ref={rootRef}
      className="fixed right-6 z-50 flex flex-col items-end gap-3"
      style={{ bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}
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
        <span className="pointer-events-none absolute top-1/2 right-full mr-3 hidden -translate-y-1/2 bg-ink px-2 py-1 text-xs whitespace-nowrap text-chalk opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 md:block">
          Butuh bantuan?
        </span>
        <button
          ref={buttonRef}
          type="button"
          aria-label="Menu bantuan"
          aria-expanded={open}
          aria-controls="support-menu"
          aria-haspopup="true"
          onClick={() => setOpen((current) => !current)}
          className="grid size-12 place-items-center rounded-full bg-oxide text-chalk shadow-lg transition-colors duration-150 hover:bg-petrol focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-oxide"
        >
          <HelpIcon className="size-6" />
        </button>
      </div>
    </div>
  );
}
