export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-baseline gap-0.5 font-sans text-xl font-extrabold tracking-[-0.06em] ${className}`}
    >
      rexu<span className="text-oxide">AI</span>
    </span>
  );
}
