import { SETTINGS_KEYS } from '@rexu/shared';
import { createDb, loadEnv } from './index.js';
import { systemSettings } from './schema/index.js';

loadEnv();

const { db, pool } = createDb();

const settings: { key: string; value: unknown; isPublic: boolean }[] = [
  {
    key: SETTINGS_KEYS.registrationMode,
    value: process.env.REGISTRATION_MODE === 'public' ? 'public' : 'closed',
    isPublic: true,
  },
  {
    key: SETTINGS_KEYS.billingEnabled,
    value: process.env.BILLING_ENABLED === 'true',
    isPublic: false,
  },
  { key: SETTINGS_KEYS.billingDefaultReserve, value: 8192, isPublic: false },
  { key: SETTINGS_KEYS.billingMaxReserve, value: 32768, isPublic: false },
  { key: SETTINGS_KEYS.publicModelMultipliers, value: true, isPublic: true },
  { key: SETTINGS_KEYS.maintenanceMode, value: false, isPublic: true },
];

try {
  for (const setting of settings) {
    await db
      .insert(systemSettings)
      .values({ ...setting, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: setting.value, isPublic: setting.isPublic, updatedAt: new Date() },
      });
  }
  console.log(`seeded ${settings.length} system settings`);
} finally {
  await pool.end();
}
