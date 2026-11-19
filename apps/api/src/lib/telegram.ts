import { env } from '../config/env.js';

type TelegramResult = { sent: boolean; error?: string };

/**
 * Escape dynamic values before inserting them into Telegram Rich HTML.
 * `&` must be replaced first so existing entities are not double-escaped.
 */
export function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Send a Telegram Rich Message (Bot API 10.1+).
 * Failures are logged and returned, never thrown, so a broken notification
 * cannot crash the API or a cron run.
 */
export async function sendTelegram(htmlMessage: string): Promise<TelegramResult> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHAT_ID?.trim();

  if (!token || !chatId) {
    console.warn('[telegram] Telegram not configured (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID empty)');
    return { sent: false, error: 'Telegram not configured' };
  }

  const threadId = env.TELEGRAM_THREAD_ID?.trim();
  const body = {
    chat_id: chatId,
    rich_message: {
      html: htmlMessage,
    },
    ...(threadId ? { message_thread_id: Number(threadId) || threadId } : {}),
  };

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendRichMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const responseBody = await response.text().catch(() => '');
      const detail = responseBody.slice(0, 1_000) || '(empty response body)';
      console.error(`[telegram] sendRichMessage failed with HTTP ${response.status}: ${detail}`);
      return {
        sent: false,
        error: `Telegram HTTP ${response.status}: ${detail}`,
      };
    }

    return { sent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[telegram] sendRichMessage request failed:', message);
    return { sent: false, error: message };
  }
}
