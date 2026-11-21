import { env } from '../config/env.js';

type SkymailResponse = {
  code?: number | string;
  message?: string;
};

/** Kirim email transaksional lewat Skymail. */
export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const response = await fetch(env.SKYMAIL_API_URL, {
    method: 'POST',
    headers: {
      Authorization: env.SKYMAIL_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      accountId: env.SKYMAIL_ACCOUNT_ID,
      name: env.SKYMAIL_SENDER_NAME,
      receiveEmail: [params.to],
      subject: params.subject,
      content: params.html,
      text: params.text,
      sendType: '',
      attachments: [],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const raw = await response.text();
  let data: SkymailResponse | null = null;
  if (raw.trim()) {
    try {
      data = JSON.parse(raw) as SkymailResponse;
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const message = data?.message ?? `HTTP ${response.status}`;
    throw new Error(`Email gagal dikirim: ${message}`);
  }

  // Skymail membalas 200 dengan body kosong saat token kedaluwarsa/tidak valid.
  if (!data) {
    throw new Error(
      'Email gagal dikirim: respons Skymail kosong atau bukan JSON. Periksa SKYMAIL_TOKEN.',
    );
  }

  if (Number(data.code) !== 200) {
    throw new Error(`Email gagal dikirim: ${data.message ?? `kode ${String(data.code)}`}`);
  }
}
