import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const styles: Record<Variant, string> = {
  primary:
    'bg-ink text-paper border-ink hover:bg-petrol hover:border-petrol disabled:bg-muted disabled:border-muted',
  secondary:
    'bg-transparent text-ink border-line hover:border-ink hover:bg-chalk disabled:text-muted',
  ghost:
    'bg-transparent text-muted border-transparent hover:text-ink hover:bg-chalk disabled:text-muted',
  danger:
    'bg-transparent text-oxide border-line hover:border-oxide hover:bg-oxide hover:text-chalk disabled:text-muted',
};

export function Button({
  variant = 'primary',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-10 items-center justify-center border px-4 text-sm font-semibold tracking-[-0.01em] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-oxide disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...props}
    />
  );
}
