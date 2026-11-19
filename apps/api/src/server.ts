import { buildApp } from './app.js';
import { env } from './config/env.js';
import { startMonitorCrons } from './modules/monitor/cron.js';

const app = await buildApp();

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ host: '0.0.0.0', port: env.PORT });

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    startMonitorCrons(app.log);
    app.log.info('Telegram monitor aktif');
  } else {
    app.log.info('Telegram tidak dikonfigurasi, monitor dinonaktifkan');
  }
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
