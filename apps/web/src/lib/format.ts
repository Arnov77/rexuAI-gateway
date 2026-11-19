export function formatNumber(value: number | string | null | undefined): string {
  if (value == null) return '0';
  const number = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(number)) return String(value);
  return new Intl.NumberFormat('id-ID').format(number);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function textFromMessage(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: unknown }).text ?? '');
        }
        return '';
      })
      .join(' ')
      .trim();
  }
  return '';
}
