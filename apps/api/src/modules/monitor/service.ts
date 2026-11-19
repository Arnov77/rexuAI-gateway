import { getDb, schema } from '@rexu/db';
import { and, count, eq, lt } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { escapeHtml, sendTelegram } from '../../lib/telegram.js';
import { bankai } from '../../providers/bankai.js';
import { checkUpstreamHealth } from './upstream-health.js';

const { usageLogs } = schema;

const numberFormatter = new Intl.NumberFormat('id-ID');

/** In-memory state: intentionally not persisted, resets on process restart. */
let lastQuotaNotifLevel: null | 'warn' | 'critical' = null;
let lastUpstreamStatus: null | 'ok' | 'error' | 'degraded' = null;
let lastReconcileNotifAt: Date | null = null;

type QuotaSnapshot = {
  remaining: number;
  total: number;
  used: number;
  usedPct: number;
};

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseQuota(body: unknown): QuotaSnapshot {
  const root = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const usage =
    typeof root.usage === 'object' && root.usage !== null
      ? (root.usage as Record<string, unknown>)
      : {};

  const remaining = numberOrNull(
    root.remainingTokens ?? root.remaining_tokens ?? root.remaining_quota,
  );
  const usedFromBody =
    numberOrNull(root.used_quota ?? root.usedQuota) ??
    numberOrNull(usage.total_tokens ?? usage.totalTokens);
  const total = numberOrNull(
    root.maxTokens ?? root.max_tokens ?? root.totalTokens ?? root.total_tokens ?? root.total_quota,
  );

  const resolvedTotal =
    total ?? (remaining != null && usedFromBody != null ? remaining + usedFromBody : null);

  if (remaining == null || resolvedTotal == null || resolvedTotal <= 0) {
    throw new Error('Respons quota BankAI tidak memuat remaining/maxTokens yang valid');
  }

  const used = Math.max(0, resolvedTotal - remaining);
  return {
    remaining,
    total: resolvedTotal,
    used,
    usedPct: (used / resolvedTotal) * 100,
  };
}

export async function checkQuota(): Promise<void> {
  const quota = await bankai.getQuota();
  const snapshot = parseQuota(quota.body);

  if (snapshot.usedPct >= env.MONITOR_QUOTA_CRITICAL_PCT && lastQuotaNotifLevel !== 'critical') {
    const result = await sendTelegram(
      `<h3>🚨 QUOTA BANKAI KRITIS</h3>
<table>
  <tr><th>Metrik</th><th>Nilai</th></tr>
  <tr><td><b>Status</b></td><td><mark>CRITICAL (≥ ${env.MONITOR_QUOTA_CRITICAL_PCT}%)</mark></td></tr>
  <tr><td><b>Terpakai</b></td><td><code>${snapshot.usedPct.toFixed(1)}%</code></td></tr>
  <tr><td><b>Sisa Quota</b></td><td><code>${numberFormatter.format(snapshot.remaining)} token</code></td></tr>
  <tr><td><b>Total Kapasitas</b></td><td><code>${numberFormatter.format(snapshot.total)} token</code></td></tr>
</table>
<p><b>Tindakan:</b> Topup segera atau layanan akan terganggu!</p>`,
    );
    if (result.sent) lastQuotaNotifLevel = 'critical';
    return;
  }

  if (
    snapshot.usedPct >= env.MONITOR_QUOTA_WARN_PCT &&
    snapshot.usedPct < env.MONITOR_QUOTA_CRITICAL_PCT &&
    lastQuotaNotifLevel !== 'warn'
  ) {
    const result = await sendTelegram(
      `<h3>⚠️ Quota BankAI Hampir Habis</h3>
<table>
  <tr><th>Metrik</th><th>Nilai</th></tr>
  <tr><td><b>Status</b></td><td><mark>WARNING (≥ ${env.MONITOR_QUOTA_WARN_PCT}%)</mark></td></tr>
  <tr><td><b>Terpakai</b></td><td><code>${snapshot.usedPct.toFixed(1)}%</code></td></tr>
  <tr><td><b>Detail Penggunaan</b></td><td><code>${numberFormatter.format(snapshot.used)}</code> / <code>${numberFormatter.format(snapshot.total)} token</code></td></tr>
  <tr><td><b>Sisa Quota</b></td><td><code>${numberFormatter.format(snapshot.remaining)} token</code></td></tr>
</table>
<p>Segera lakukan topup untuk menghindari gangguan layanan.</p>`,
    );
    if (result.sent) lastQuotaNotifLevel = 'warn';
    return;
  }

  if (snapshot.usedPct < env.MONITOR_QUOTA_WARN_PCT && lastQuotaNotifLevel !== null) {
    // Quota sudah turun (mis. setelah topup), reset agar notifikasi bisa terkirim lagi.
    lastQuotaNotifLevel = null;
  }
}

function upstreamErrorMessage(result: Awaited<ReturnType<typeof checkUpstreamHealth>>): string {
  const parts = [result.error ?? 'unknown'];
  if (result.details.httpStatus != null) parts.push(`HTTP ${result.details.httpStatus}`);
  return parts.join(' · ');
}

export async function checkUpstream(): Promise<void> {
  const result = await checkUpstreamHealth();
  const previous = lastUpstreamStatus;

  if (previous === result.status) return;

  if (previous == null) {
    lastUpstreamStatus = result.status;
    return;
  }

  let message: string;
  if (result.status === 'ok') {
    message = `<h3>✅ BankAI Kembali Normal</h3>
<table>
  <tr><th>Parameter</th><th>Detail</th></tr>
  <tr><td><b>Status</b></td><td><mark>RECOVERED (OK)</mark></td></tr>
  <tr><td><b>Latensi</b></td><td><code>${result.latencyMs} ms</code></td></tr>
  <tr><td><b>Waktu Pulih</b></td><td><code>${result.checkedAt}</code></td></tr>
</table>
<p>Downtime telah berakhir dan layanan kembali normal.</p>`;
  } else if (result.status === 'degraded') {
    message = `<h3>🟡 BankAI Merespons Tapi Mencurigakan</h3>
<table>
  <tr><th>Parameter</th><th>Detail</th></tr>
  <tr><td><b>Status</b></td><td><mark>DEGRADED</mark></td></tr>
  <tr><td><b>Indikasi</b></td><td><code>completion_tokens</code> terlalu rendah${
    result.details.completionTokens != null
      ? ` (<code>${result.details.completionTokens}</code>)`
      : ''
  }</td></tr>
  <tr><td><b>Waktu</b></td><td><code>${result.checkedAt}</code></td></tr>
</table>
<p>Kemungkinan API key bermasalah atau limit upstream aktif.</p>`;
  } else {
    message = `<h3>🔴 BankAI Tidak Terhubung</h3>
<table>
  <tr><th>Parameter</th><th>Detail</th></tr>
  <tr><td><b>Status</b></td><td><mark>DOWN (error)</mark></td></tr>
  <tr><td><b>Waktu</b></td><td><code>${result.checkedAt}</code></td></tr>
</table>
<details>
  <summary>🔍 <b>Lihat Detail Error &amp; Solusi</b></summary>
  <p><b>Error:</b> <code>${escapeHtml(upstreamErrorMessage(result))}</code></p>
  <p>Periksa <code>BANKAI_API_KEY</code> dan koneksi jaringan ke upstream.</p>
</details>`;
  }

  const sent = await sendTelegram(message);
  if (sent.sent) lastUpstreamStatus = result.status;
}

export async function checkReconciliation(): Promise<void> {
  const cutoff = new Date(Date.now() - env.MONITOR_RECONCILE_PENDING_HOURS * 3_600_000);
  const [row] = await getDb()
    .select({ total: count() })
    .from(usageLogs)
    .where(and(eq(usageLogs.status, 'reconciliation'), lt(usageLogs.createdAt, cutoff)));

  const total = row?.total ?? 0;
  if (total <= 0) return;

  if (lastReconcileNotifAt !== null && Date.now() - lastReconcileNotifAt.getTime() < 3_600_000) {
    return;
  }

  const sent = await sendTelegram(
    `<h3>🔧 Request Pending Rekonsiliasi</h3>
<table>
  <tr><th>Parameter</th><th>Detail</th></tr>
  <tr><td><b>Jumlah Pending</b></td><td><mark>${total} request</mark></td></tr>
  <tr><td><b>Durasi Tertunda</b></td><td><code>&gt; ${env.MONITOR_RECONCILE_PENDING_HOURS} jam</code></td></tr>
  <tr><td><b>Endpoint Admin</b></td><td><code>/admin/reconcile</code></td></tr>
</table>
<p>Buka admin panel untuk menyelesaikan billing settlement yang tertunda.</p>`,
  );

  if (sent.sent) lastReconcileNotifAt = new Date();
}
