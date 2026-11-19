import { getDb, schema } from '@rexu/db';
import { SETTINGS_KEYS } from '@rexu/shared';
import { eq } from 'drizzle-orm';

const { systemSettings } = schema;

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const rows = await getDb()
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, key))
    .limit(1);
  return (rows[0]?.value as T | undefined) ?? fallback;
}

export async function getPublicSettings(): Promise<{
  registrationMode: 'closed' | 'public';
  publicModelMultipliers: boolean;
  maintenanceMode: boolean;
}> {
  const [registrationMode, publicModelMultipliers, maintenanceMode] = await Promise.all([
    getSetting(SETTINGS_KEYS.registrationMode, 'closed'),
    getSetting(SETTINGS_KEYS.publicModelMultipliers, true),
    getSetting(SETTINGS_KEYS.maintenanceMode, false),
  ]);

  return {
    registrationMode: registrationMode === 'public' ? 'public' : 'closed',
    publicModelMultipliers,
    maintenanceMode,
  };
}
