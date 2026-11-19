import { getDb, schema } from '@rexu/db';
import { and, eq, inArray, like, notInArray, or, sql } from 'drizzle-orm';
import { badRequest, notFound } from '../../lib/errors.js';
import { serializeModel } from '../../lib/serialize.js';
import { bankai } from '../../providers/bankai.js';

const { models } = schema;

function isFreeUpstreamModel(model: { id: string; gateway?: string }): boolean {
  return model.gateway === 'free' || model.id.endsWith('-FREE');
}

export async function syncModels(): Promise<{
  synced: number;
  created: number;
  missing: number;
  skippedFree: number;
}> {
  const upstream = await bankai.listModels();
  const now = new Date();
  const paid = upstream.filter((model) => !isFreeUpstreamModel(model));
  const freeIds = upstream.filter(isFreeUpstreamModel).map((model) => model.id);
  const ids = paid.map((model) => model.id);

  const existing =
    ids.length > 0
      ? await getDb().select({ id: models.id }).from(models).where(inArray(models.id, ids))
      : [];
  const existingIds = new Set(existing.map((row) => row.id));
  const created = ids.filter((id) => !existingIds.has(id)).length;

  if (ids.length > 0) {
    await getDb()
      .insert(models)
      .values(
        paid.map((model) => ({
          id: model.id,
          displayName: model.id,
          provider: model.owned_by || 'bankai',
          description: null,
          contextWindow: null,
          inputModalities: model.modalities?.input ?? ['text'],
          outputModalities: model.modalities?.output ?? ['text'],
          vision: Boolean(model.vision),
          streaming: false,
          isAvailable: Boolean(model.available),
          isEnabled: false,
          multiplierBp: null,
          upstreamMetadata: model as unknown as Record<string, unknown>,
          lastSyncedAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: models.id,
        set: {
          isAvailable: sql`excluded.is_available`,
          vision: sql`excluded.vision`,
          inputModalities: sql`excluded.input_modalities`,
          outputModalities: sql`excluded.output_modalities`,
          upstreamMetadata: sql`excluded.upstream_metadata`,
          lastSyncedAt: now,
          updatedAt: now,
        },
      });
  }

  const missing = await getDb()
    .update(models)
    .set({ isAvailable: false, lastSyncedAt: now, updatedAt: now })
    .where(ids.length > 0 ? notInArray(models.id, ids) : eq(models.isAvailable, true))
    .returning({ id: models.id });

  const freeCondition =
    freeIds.length > 0
      ? or(like(models.id, '%-FREE'), inArray(models.id, freeIds))
      : like(models.id, '%-FREE');
  await getDb()
    .update(models)
    .set({ isEnabled: false, isAvailable: false, lastSyncedAt: now, updatedAt: now })
    .where(freeCondition);

  return {
    synced: ids.length,
    created,
    missing: missing.length,
    skippedFree: upstream.length - ids.length,
  };
}

export async function listModelsForAdmin() {
  return getDb().select().from(models).orderBy(models.id);
}

export async function listEnabledModels(showMultiplier: boolean) {
  const rows = await getDb()
    .select()
    .from(models)
    .where(and(eq(models.isEnabled, true), eq(models.isAvailable, true)))
    .orderBy(models.displayName);
  return rows.map((row) => serializeModel(row, showMultiplier));
}

export async function getModelForRequest(id: string) {
  const rows = await getDb().select().from(models).where(eq(models.id, id)).limit(1);
  return rows[0] ?? null;
}

export type UpdateModelInput = {
  displayName?: string;
  description?: string | null;
  multiplierBp?: number | null;
  bankaiMultiplierBp?: number;
  minBlockOverride?: number | null;
  isEnabled?: boolean;
  streaming?: boolean;
  category?: string | null;
  contextWindow?: number | null;
};

export async function updateModel(id: string, input: UpdateModelInput) {
  const current = await getModelForRequest(id);
  if (!current) throw notFound('Model tidak ditemukan');

  const nextMultiplier =
    input.multiplierBp === undefined ? current.multiplierBp : input.multiplierBp;
  const nextEnabled = input.isEnabled === undefined ? current.isEnabled : input.isEnabled;
  if (nextEnabled && nextMultiplier == null) {
    throw badRequest('Multiplier wajib diisi sebelum model diaktifkan');
  }
  if (nextMultiplier != null && nextMultiplier <= 0) {
    throw badRequest('Multiplier harus lebih besar dari 0');
  }
  if (input.bankaiMultiplierBp != null && input.bankaiMultiplierBp < 0) {
    throw badRequest('BankAI multiplier tidak boleh negatif');
  }
  if (input.minBlockOverride != null && input.minBlockOverride < 0) {
    throw badRequest('Min block override tidak boleh negatif');
  }

  const [updated] = await getDb()
    .update(models)
    .set({
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.multiplierBp !== undefined ? { multiplierBp: input.multiplierBp } : {}),
      ...(input.bankaiMultiplierBp !== undefined
        ? { bankaiMultiplierBp: input.bankaiMultiplierBp }
        : {}),
      ...(input.minBlockOverride !== undefined ? { minBlockOverride: input.minBlockOverride } : {}),
      ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {}),
      ...(input.streaming !== undefined ? { streaming: input.streaming } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.contextWindow !== undefined ? { contextWindow: input.contextWindow } : {}),
      updatedAt: new Date(),
    })
    .where(eq(models.id, id))
    .returning();

  if (!updated) throw notFound('Model tidak ditemukan');
  return updated;
}
