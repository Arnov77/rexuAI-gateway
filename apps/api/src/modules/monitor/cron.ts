import { env } from '../../config/env.js';
import { checkQuota, checkReconciliation, checkUpstream } from './service.js';

export type MonitorLogger = {
  info: (message: string) => void;
  error: (context: { err: unknown }, message: string) => void;
};

const consoleLogger: MonitorLogger = {
  info: (message) => console.log(`[monitor] ${message}`),
  error: (context, message) => console.error(`[monitor] ${message}`, context.err),
};

let started = false;

export function startMonitorCrons(logger: MonitorLogger = consoleLogger): void {
  if (started) return;
  started = true;

  // Quota check
  setInterval(() => {
    void checkQuota().catch((err) => logger.error({ err }, 'quota check failed'));
  }, env.MONITOR_QUOTA_INTERVAL_MS);

  // Upstream check
  setInterval(() => {
    void checkUpstream().catch((err) => logger.error({ err }, 'upstream check failed'));
  }, env.MONITOR_UPSTREAM_INTERVAL_MS);

  // Reconciliation check
  setInterval(() => {
    void checkReconciliation().catch((err) => logger.error({ err }, 'reconcile check failed'));
  }, env.MONITOR_RECONCILE_INTERVAL_MS);

  // Jalankan sekali saat startup setelah 30 detik
  // (beri waktu server fully ready)
  setTimeout(() => {
    void checkQuota().catch(() => {});
    void checkUpstream().catch(() => {});
    void checkReconciliation().catch(() => {});
  }, 30_000);

  logger.info('Monitor crons started');
}
